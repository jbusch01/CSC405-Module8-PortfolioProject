'use strict';

// =================================================================
// Painter's Algorithm Demo: Rotating House
// - Primitive: triangle
// - Object: simple house (box + pyramid roof, 16 triangles total)
// - Hidden-surface removal: implemented via Painter's Algorithm,
//   i.e., sorting triangles back-to-front in JavaScript each frame.
// - Note: Depth testing (z-buffer) is disabled on purpose.
// =================================================================

// ---
// Global WebGL variables
// ------
let canvas = null;
let gl = null;

let shaderProgram = null;
let aPositionLoc = null;
let aColorLoc = null;
let uModelViewMatrixLoc = null;
let uProjectionMatrixLoc = null;

let positionBuffer = null;
let colorBuffer = null;

// Rotation angle for animation (in radians)
let rotationY = 0.0;

//
// Basic 4x4 matrix utilities (column-major, OpenGL-style)
//

// Create an identity 4x4 matrix
function mat4Identity() {
    // Column-major layout:
    // [ 1, 0, 0, 0,
    //   0, 1, 0, 0,
    //   0, 0, 1, 0,
    //   0, 0, 0, 1, ]
    return new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);
}

// Multiplyh two 4x4 matrices: out = a * b
function mat4Multiply(a, b) {
    const out = new Float32Array(16);

    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            let sum = 0.0;
            for (let k = 0; k < 4; k++) {
                // index = col*4 + row (column-major)
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        } 
    }

    return out;
}

// Create a translation matrix
function mat4Translate(tx, ty, tz) {
    const out = mat4Identity();
    out[12] = tx; // 4th columnm, row 0
    out[13] = ty; // 4th column, row 1
    out[14] = tz; // 4th column, row 2
    return out;
}

// Create a rotation around Y axis
function mat4RotateY(angleRad) {
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);
    return new Float32Array([
         c, 0, s, 0,
         0, 1, 0, 0,
        -s, 0, c, 0,
         0, 0, 0, 1
    ]);
}

// Perspective projection matrix (field-of-view in radians)
function mat4Perspective(fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2.0);
    const nf = 1.0 / (near - far);

    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;

    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;

    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;

    out[12] = 0;
    out[13] = 0;
    out[14] = (2 * far * near) * nf;
    out[15] = 0;

    return out;
}

// Transform a vec3 by a 4x4 matrix (assuming w = 1.0)
// Used for computing view-space coordinates for depth
function transformVec3(mat, v) {
    const x = v[0], y = v[1], z = v[2];
    const vx = mat[0] * x + mat[4] * y + mat[8]  * z + mat[12];
    const vy = mat[1] * x + mat[5] * y + mat[9]  * z + mat[13];
    const vz = mat[2] * x + mat[6] * y + mat[10] * z + mat[14];
    // We ignore w because this is before projection; we treat this as view space
    return [vx, vy, vz];
}

// ===
// House geometry setup (triangles in model space)
// ===

// Convenience function to build a vec3
function vec3(x, y, z) {
    return [x, y, z];
}

// Each triangle: { vertices: [v0, v1, v2], color: [r, g, b], depth: 0 }
const houseTriangles = [];

// Helper to add triangle to house mesh
function addTriangle(a, b, c, color) {
    houseTriangles.push({
        vertices: [a, b, c],
        color: color,
        depth: 0.0
    });
}

// Build the house geometry
function buildHouseGeometry() {
    // 1) Define the 8 box corners (body of house)
    const v0 = vec3(-0.5, 0.0,  0.5); // front-bottom-left
    const v1 = vec3( 0.5, 0.0,  0.5); // front-bottom-right
    const v2 = vec3( 0.5, 0.6,  0.5); // front-top-right
    const v3 = vec3(-0.5, 0.6,  0.5); // front-top-left

    const v4 = vec3(-0.5, 0.0, -0.5); // back-bottom-left
    const v5 = vec3( 0.5, 0.0, -0.5); // back-bottom-right
    const v6 = vec3( 0.5, 0.6, -0.5); // back-top-right
    const v7 = vec3(-0.5, 0.6, -0.5); // back-top-left

    // Roof apex
    const apex = vec3(0.0, 1.0, 0.0); // front-bottom-left

    // Colors
    const WALL_COLOR_FRONT  = [0.9, 0.8, 0.7];
    const WALL_COLOR_BACK   = [0.85, 0.75, 0.65];
    const WALL_COLOR_LEFT   = [0.88, 0.78, 0.68];
    const WALL_COLOR_RIGHT  = [0.88, 0.78, 0.68];
    const WALL_COLOR_TOP    = [0.95, 0.9, 0.8];
    const WALL_COLOR_BOTTOM = [0.4, 0.3, 0.25];
    const ROOF_COLOR        = [0.8, 0.1, 0.1];

    // --- Walls (each rectangular face is two triangles) ---

    // Front wall (v0, v1, v2, v3)
    addTriangle(v0, v1, v2, WALL_COLOR_FRONT);
    addTriangle(v0, v2, v3, WALL_COLOR_FRONT);

    // Right wall (v1, v5, v6, v2)
    addTriangle(v1, v5, v6, WALL_COLOR_RIGHT);
    addTriangle(v1, v6, v2, WALL_COLOR_RIGHT);

    // Back wall (v5, v4, v7, v6)
    addTriangle(v5, v4, v7, WALL_COLOR_BACK);
    addTriangle(v5, v7, v6, WALL_COLOR_BACK);

    // Left wall (v4, v0, v3, v7)
    addTriangle(v4, v0, v3, WALL_COLOR_LEFT);
    addTriangle(v4, v3, v7, WALL_COLOR_LEFT);

    // Bottom (foundation) (v4, v5, v1, v0)
    addTriangle(v4, v5, v1, WALL_COLOR_BOTTOM);
    addTriangle(v4, v1, v0, WALL_COLOR_BOTTOM);

    // Top (ceiling under roof) (v3, v2, v6, v7)
    addTriangle(v3, v2, v6, WALL_COLOR_TOP);
    addTriangle(v3, v6, v7, WALL_COLOR_TOP);

    // --- Roof (pyramid) ---

    // Front roof face (v2, v6, apex)
    addTriangle(v3, v2, apex, ROOF_COLOR);

    // Right roof face (v2, v6, apex)
    addTriangle(v2, v6, apex, ROOF_COLOR);

    // Back roof face (v6, v7, apex)
    addTriangle(v6, v7, apex, ROOF_COLOR);

    // Left roof face (v7, v3, apex)
    addTriangle(v7, v3, apex, ROOF_COLOR);

    // At this point, houseTriangles contains 16 triangles
}

// ===
// Painter's Algorithm: depth computation + sorting
// ===

// For each triangle, compute its average z in view space and store in tri.depth
function computeTriangleDepths(modelViewMatrix) {
    for (let i = 0; i < houseTriangles.length; i++) {
        const tri = houseTriangles[i];
        const v0 = transformVec3(modelViewMatrix, tri.vertices[0]);
        const v1 = transformVec3(modelViewMatrix, tri.vertices[1]);
        const v2 = transformVec3(modelViewMatrix, tri.vertices[2]);

        // Average z value in view space
        const zAvg = (v0[2] + v1[2] + v2[2]) / 3.0;
        tri.depth = zAvg;
    }
}

// Sort traingles back-to-front (Painter's Algorithm)
// Note: In view space, more psoitive z is closer if camera loos down -z.
// We want to draw farthest first, so sort by depth ascending (more negtvie first),
// or equivalently descending if you flip sign. Here we use ascending.
function sortTriangleBackToFront() {
    houseTriangles.sort((a, b) => {
        return a.depth - b.depth; // more negative (farther) first
    });
}

// ===
// Flatten triangles into GPU-friendly buffers (positions & colors)
// ===

function buildBuffersFromSortedTriangles() {
    const numTriangles = houseTriangles.length;
    const numVertices = numTriangles * 3;

    const positions = new Float32Array(numVertices * 3); // x,y,z par vertex
    const colors    = new Float32Array(numVertices * 3); // r,g,b per vertex

    let pIndex = 0;
    let cIndex = 0;

    for (let i = 0; i < numTriangles; i++) {
        const tri = houseTriangles[i];
        const color = tri.color;

        for (let v = 0; v < 3; v++) {
            const vert = tri.vertices[v];
            positions[pIndex++] = vert[0];
            positions[pIndex++] = vert[1];
            positions[pIndex++] = vert[2];

            colors[cIndex++] = color[0];
            colors[cIndex++] = color[1];
            colors[cIndex++] = color[2];
        }
    }

    // Upload data to GPU buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

    return numVertices;
}

// ===
// Shader compilation / program linking helpers
// ===

function getShaderSource(id) {
    const script = document.getElementById(id);
    if (!script) {
        throw new Error('Could not find shader script with id: ' + id);
    }
    return script.textContent;
}

function compileShader(source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Could not compile shader:\n' + info);
    }

    return shader;
}

function createShaderProgram() {
    const vertSrc = getShaderSource('vertex-shader');
    const fragSrc = getShaderSource('fragment-shader');

    const vertShader = compileShader(vertSrc, gl.VERTEX_SHADER);
    const fragShader = compileShader(fragSrc, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error('Could not link program:\n' + info);
    }

    return program;
}

// ===
// Initialization
// ===

function initGL() {
    canvas = document.getElementById('glCanvas');
    gl = canvas.getContext('webgl');
    if (!gl) {
        alert('WebGL not supported in this browser.');
        throw new Error('WebGL not supported');
    }

    // Adjust canvas resolution to client size
    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(canvas.clientWidth * dpr);
        const height = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    resize();
    window.addEventListener('resize', resize);

    // Clear color & nop depth testing (we are using Painter's Algorithm instead)
    gl.clearColor(0.1, 0.1, 0.15, 1.0);
    gl.disable(gl.DEPTH_TEST); // <--- for this assignemnt, specifically
    gl.disable(gl.CULL_FACE); // draw both front and back faces

    // Create shader program and get attribute/uniform locations
    shaderProgram = createShaderProgram();
    gl.useProgram(shaderProgram);

    aPositionLoc = gl.getAttribLocation(shaderProgram, 'aPosition');
    aColorLoc    = gl.getAttribLocation(shaderProgram, 'aColor');

    uModelViewMatrixLoc  = gl.getUniformLocation(shaderProgram, 'uModelViewMatrix');
    uProjectionMatrixLoc = gl.getUniformLocation(shaderProgram, 'uProjectionMatrix');

    // Create GPU buffers (empty for now; data will be uploaded each frame)
    positionBuffer = gl.createBuffer();
    colorBuffer    = gl.createBuffer();

    // Enable vertex attribute arrays
    gl.enableVertexAttribArray(aPositionLoc);
    gl.enableVertexAttribArray(aColorLoc);

    // Build the house geometry once (static in model space)
    buildHouseGeometry();
}

// ===
// Rendering / Animation loop
// ===

function drawScene(timeMs) {
    // Convert time to seconds and update rotation angle
    const timeSec = timeMs * 0.001;
    rotationY = timeSec * 0.5; // rotate slowly over time

    gl.clear(gl.COLOR_BUFFER_BIT);

    // --- 1. Build model-view and projection matrices ---
    const aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;

    // Camera: simply translate house back along -z to be in front of camera
    const modelRotate = mat4RotateY(rotationY);
    const modelTranslate = mat4Translate(0.0, -0.2, -3.0);
    const modelViewMatrix = mat4Multiply(modelTranslate, modelRotate);

    const projectionMatrix = mat4Perspective(
        Math.PI / 4, // 45 degrees field-of-view
        aspect,
        0.1,
        100.0
    );

    // --- 2. Painter's Algorithm: compute depths & sort ---
    computeTriangleDepths(modelViewMatrix);
    sortTriangleBackToFront();

    // --- 3. Flatten sorted triangles and upload to GPU ---
    const numVertices = buildBuffersFromSortedTriangles();

    // --- 4. Bind buffers and set up attributes ---
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(
        aPositionLoc,
        3,     // x, y, z
        gl.FLOAT,
        false,
        0,
        0
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.vertexAttribPointer(
        aColorLoc,
        3,     // r, g, b
        gl.FLOAT,
        false,
        0,
        0
    );

    // --- 5. Upload matrices to shader uniforms ---
    gl.uniformMatrix4fv(uModelViewMatrixLoc, false, modelViewMatrix);
    gl.uniformMatrix4fv(uProjectionMatrixLoc, false, projectionMatrix);

    // --- 6. Draw the triagnles in the sorted order ---
    gl.drawArrays(gl.TRIANGLES, 0, numVertices);

    // Request the next frame
    requestAnimationFrame(drawScene);
}

// Entry point
window.addEventListener('load', () => {
    initGL();
    requestAnimationFrame(drawScene);
});
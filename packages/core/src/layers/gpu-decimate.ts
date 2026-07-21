/**
 * GPU-side min/max decimation via transform feedback.
 *
 * The CPU path in `line.ts` (see {@link decimateIndices}) rebuilds the per-column
 * min/max envelope in a JS loop whenever the view changes — O(visible points) on
 * the main thread, which janks when panning multi-million-point series. This
 * moves that reduction onto the GPU: the full series lives in an RG32F texture,
 * and a rasterizer-discarded vertex pass computes each column's extremes with
 * `texelFetch` and captures the result straight into the draw buffer via
 * transform feedback — no per-point CPU work and no readback.
 *
 * It is used only for large series (the CPU path is already cheap for small
 * ones) and falls back to the CPU path on any capability gap or GL error, so the
 * rendered envelope is identical either way.
 */

const DEC_VERT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uPoints;
uniform int uTexW;
uniform int uI0;
uniform int uI1;
uniform int uCols;
uniform int uMaxIter;      // per-column iteration cap; stride-samples beyond it
out vec2 vOut;

vec2 fetchPoint(int i) {
  return texelFetch(uPoints, ivec2(i % uTexW, i / uTexW), 0).xy;
}

void main() {
  int v = gl_VertexID;
  int last = 2 * uCols + 1;
  int idx;
  if (v == 0) {
    idx = uI0;                       // left endpoint, so the line reaches the edge
  } else if (v >= last) {
    idx = uI1;                       // right endpoint
  } else {
    int col = (v - 1) / 2;
    int which = (v - 1) - col * 2;   // 0 => min-index extreme, 1 => max-index extreme
    // Float division avoids int32 overflow of visN*col for huge series.
    float fvisN = float(uI1 - uI0);
    int lo = uI0 + int(floor(fvisN * float(col) / float(uCols)));
    int hi = uI0 + int(floor(fvisN * float(col + 1) / float(uCols)));
    if (hi <= lo) {
      idx = lo;
    } else {
      int stride = 1;
      int span = hi - lo;
      if (span > uMaxIter) stride = (span + uMaxIter - 1) / uMaxIter;
      int iMin = lo, iMax = lo;
      float yMin = fetchPoint(lo).y, yMax = yMin;
      for (int i = lo; i < hi; i += stride) {
        float y = fetchPoint(i).y;
        if (y < yMin) { yMin = y; iMin = i; }
        if (y > yMax) { yMax = y; iMax = i; }
      }
      // Emit in index order (matches decimateIndices) to preserve envelope shape.
      idx = (which == 0) ? min(iMin, iMax) : max(iMin, iMax);
    }
  }
  vOut = fetchPoint(idx);
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);   // rasterizer-discarded
}`;

const DEC_FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

/** Per-column iteration budget in the reduction loop before stride-sampling. */
const MAX_ITER = 4096;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Decimation shader compile error:\n${log}`);
  }
  return sh;
}

interface DecProgram {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

// Transform-feedback programs need their varyings declared before linking, so
// they can't go through the shared createProgram(). Cache one per context.
const programCache = new WeakMap<WebGL2RenderingContext, DecProgram | null>();

function getDecProgram(gl: WebGL2RenderingContext): DecProgram | null {
  if (programCache.has(gl)) return programCache.get(gl)!;
  let result: DecProgram | null = null;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, DEC_VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, DEC_FRAG);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.transformFeedbackVaryings(program, ["vOut"], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
    } else {
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const name of ["uPoints", "uTexW", "uI0", "uI1", "uCols", "uMaxIter"]) {
        u[name] = gl.getUniformLocation(program, name);
      }
      result = { program, u };
    }
  } catch {
    result = null;
  }
  programCache.set(gl, result);
  return result;
}

/**
 * Holds one series' points in a GPU texture and runs the transform-feedback
 * min/max reduction. Owned by a LineLayer; only instantiated for series large
 * enough that CPU decimation would jank.
 */
export class GpuDecimator {
  /** False when this context can't support the GPU path (fall back to CPU). */
  readonly supported: boolean;
  private gl: WebGL2RenderingContext;
  private prog: DecProgram | null;
  private tex: WebGLTexture | null = null;
  private tf: WebGLTransformFeedback | null = null;
  private emptyVao: WebGLVertexArrayObject | null = null;
  private texW = 0;
  private decCapacity = -1; // point capacity currently allocated in the draw buffer

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = getDecProgram(gl);
    this.supported = this.prog != null;
  }

  /**
   * (Re)upload the series into the point texture. `data` is interleaved
   * (x-xRef, y-yRef) float32, exactly as the draw buffer stores it. Returns
   * false and disables the GPU path if the texture can't be allocated.
   */
  setPoints(data: Float32Array, n: number): boolean {
    if (!this.supported || n === 0) return this.supported;
    const gl = this.gl;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const texW = Math.min(maxTex, Math.max(1, Math.ceil(Math.sqrt(n))));
    const texH = Math.ceil(n / texW);
    if (texH > maxTex) return false; // series too large to texture — CPU handles it
    this.texW = texW;

    const packed = data.length >= texW * texH * 2 ? data : new Float32Array(texW * texH * 2);
    if (packed !== data) packed.set(data.subarray(0, n * 2));

    try {
      if (!this.tex) this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, texW, texH, 0, gl.RG, gl.FLOAT, packed);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
    } catch {
      return false;
    }
    if (!this.tf) this.tf = gl.createTransformFeedback();
    if (!this.emptyVao) this.emptyVao = gl.createVertexArray();
    return true;
  }

  /**
   * Run the reduction for the visible window `[i0, i1]` into `decBuf`, matching
   * the CPU envelope layout: left endpoint, `cols` min/max pairs, right endpoint.
   * Returns the emitted point count, or null if the GPU path can't run this call.
   */
  run(i0: number, i1: number, cols: number, decBuf: WebGLBuffer): number | null {
    if (!this.supported || !this.tex || !this.prog) return null;
    const gl = this.gl;
    const outCount = 2 * cols + 2;

    // Grow the draw buffer to hold the envelope (interleaved vec2 float32).
    if (this.decCapacity < outCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, decBuf);
      gl.bufferData(gl.ARRAY_BUFFER, outCount * 2 * 4, gl.DYNAMIC_COPY);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.decCapacity = outCount;
    }

    const { program, u } = this.prog;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u.uPoints!, 0);
    gl.uniform1i(u.uTexW!, this.texW);
    gl.uniform1i(u.uI0!, i0);
    gl.uniform1i(u.uI1!, i1);
    gl.uniform1i(u.uCols!, cols);
    gl.uniform1i(u.uMaxIter!, MAX_ITER);

    gl.bindVertexArray(this.emptyVao);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, decBuf);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, outCount);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return outCount;
  }

  dispose(): void {
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.tf) gl.deleteTransformFeedback(this.tf);
    if (this.emptyVao) gl.deleteVertexArray(this.emptyVao);
    this.tex = null; this.tf = null; this.emptyVao = null;
  }
}

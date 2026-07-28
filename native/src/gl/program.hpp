// Port of core/src/gl/program.ts — shader compilation, linking and uniform
// lookup, plus the one thing the web version does not need: translating the
// shaders from GLSL ES 3.00 to desktop GLSL 3.30.
#pragma once

#include <photon/photon.h>

#include <string>
#include <unordered_map>
#include <vector>

#include "gl/gl.hpp"

namespace photon::gl {

/**
 * Rewrite a WebGL2 shader for the target API.
 *
 * The layers' GLSL is authored once, against `#version 300 es`, and shared with
 * the web core verbatim. Desktop GL wants `#version 330 core`; that is the
 * entire difference. `precision` qualifiers are legal (and ignored) in GLSL
 * 3.30, and every builtin these shaders use — `fwidth`, `gl_VertexID`,
 * `layout(location=)` — is core in both.
 */
std::string translate(const std::string& source, ph_gfx_api api);

/// Map a layer's render type to a buffer-usage hint. Port of bufferUsage().
GLenum buffer_usage(ph_render_type type);

/**
 * A linked program plus its uniform locations.
 *
 * Programs are cached per (Api, key) and shared by every layer of a kind, the
 * same way the web core caches them in a module-level WeakMap. A layer must
 * therefore never delete one in its destructor — the comment in CLAUDE.md about
 * `deleteProgram` applies here for exactly the same reason.
 */
struct Program {
  GLuint id = 0;
  std::unordered_map<std::string, GLint> uniforms;

  /// -1 when the uniform was optimized out, which glUniform* accepts as a no-op.
  GLint uniform(const std::string& name) const {
    const auto it = uniforms.find(name);
    return it == uniforms.end() ? -1 : it->second;
  }
};

/**
 * Compile, link and cache a program under `key`.
 *
 * Returns nullptr and fills `error` with the GLSL log on failure. The cache is
 * owned by the process and cleared by ph_shutdown.
 */
const Program* get_program(Api& api, const std::string& key,
                           const std::string& vert, const std::string& frag,
                           const std::vector<std::string>& uniform_names,
                           ph_gfx_api gfx, std::string& error);

/// Drop every cached program. Requires the GL context to still be current.
void clear_program_cache(Api& api);

}  // namespace photon::gl

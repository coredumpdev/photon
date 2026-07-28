#include "gl/program.hpp"

#include <map>

namespace photon::gl {
namespace {

/// Cache keyed by (Api instance, program key). One Api per process today, but
/// keying on it keeps the shape correct if a second context ever appears — and
/// mirrors the web core's WeakMap<gl, program>.
std::map<std::pair<const Api*, std::string>, Program>& cache() {
  static std::map<std::pair<const Api*, std::string>, Program> instance;
  return instance;
}

std::string shader_log(Api& api, GLuint shader) {
  GLint length = 0;
  api.GetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
  if (length <= 0) return "(no log)";
  std::string log(static_cast<size_t>(length), '\0');
  api.GetShaderInfoLog(shader, length, nullptr, log.data());
  // The driver counts the NUL; trim it so the message does not end mid-string.
  while (!log.empty() && log.back() == '\0') log.pop_back();
  return log;
}

std::string program_log(Api& api, GLuint program) {
  GLint length = 0;
  api.GetProgramiv(program, GL_INFO_LOG_LENGTH, &length);
  if (length <= 0) return "(no log)";
  std::string log(static_cast<size_t>(length), '\0');
  api.GetProgramInfoLog(program, length, nullptr, log.data());
  while (!log.empty() && log.back() == '\0') log.pop_back();
  return log;
}

GLuint compile(Api& api, GLenum type, const std::string& source, std::string& error) {
  const GLuint shader = api.CreateShader(type);
  if (shader == 0) {
    error = "glCreateShader returned 0";
    return 0;
  }
  const char* src = source.c_str();
  api.ShaderSource(shader, 1, &src, nullptr);
  api.CompileShader(shader);

  GLint ok = 0;
  api.GetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    error = "shader compile failed:\n" + shader_log(api, shader);
    api.DeleteShader(shader);
    return 0;
  }
  return shader;
}

}  // namespace

std::string translate(const std::string& source, ph_gfx_api api) {
  // ES 3.0 hosts (ANGLE, mobile) take the shader exactly as the web core wrote it.
  if (api == PH_GFX_GLES30) return source;

  static const std::string kEsVersion = "#version 300 es";
  static const std::string kCoreVersion = "#version 330 core";
  const size_t at = source.find(kEsVersion);
  if (at == std::string::npos) return source;

  std::string out = source;
  out.replace(at, kEsVersion.size(), kCoreVersion);
  return out;
}

GLenum buffer_usage(ph_render_type type) {
  return type == PH_RENDER_DYNAMIC ? GL_DYNAMIC_DRAW : GL_STATIC_DRAW;
}

const Program* get_program(Api& api, const std::string& key,
                           const std::string& vert, const std::string& frag,
                           const std::vector<std::string>& uniform_names,
                           ph_gfx_api gfx, std::string& error) {
  auto& programs = cache();
  const auto cache_key = std::make_pair(static_cast<const Api*>(&api), key);
  const auto found = programs.find(cache_key);
  if (found != programs.end()) return &found->second;

  const GLuint vs = compile(api, GL_VERTEX_SHADER, translate(vert, gfx), error);
  if (vs == 0) {
    error = key + " vertex " + error;
    return nullptr;
  }
  const GLuint fs = compile(api, GL_FRAGMENT_SHADER, translate(frag, gfx), error);
  if (fs == 0) {
    api.DeleteShader(vs);
    error = key + " fragment " + error;
    return nullptr;
  }

  const GLuint id = api.CreateProgram();
  api.AttachShader(id, vs);
  api.AttachShader(id, fs);
  api.LinkProgram(id);
  // Flagged for deletion now; they go away when the program releases them.
  api.DeleteShader(vs);
  api.DeleteShader(fs);

  GLint linked = 0;
  api.GetProgramiv(id, GL_LINK_STATUS, &linked);
  if (!linked) {
    error = key + " link failed:\n" + program_log(api, id);
    api.DeleteProgram(id);
    return nullptr;
  }

  Program program;
  program.id = id;
  for (const auto& name : uniform_names) {
    program.uniforms[name] = api.GetUniformLocation(id, name.c_str());
  }
  return &programs.emplace(cache_key, std::move(program)).first->second;
}

void clear_program_cache(Api& api) {
  auto& programs = cache();
  for (auto it = programs.begin(); it != programs.end();) {
    if (it->first.first == &api) {
      if (api.ready && it->second.id != 0) api.DeleteProgram(it->second.id);
      it = programs.erase(it);
    } else {
      ++it;
    }
  }
}

}  // namespace photon::gl

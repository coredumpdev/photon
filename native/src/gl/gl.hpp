// OpenGL 3.3 core entry points, resolved through the host's get_proc_address.
//
// No glad, no GLEW, no system GL headers. Three reasons: the repo's TypeScript
// half ships zero dependencies and the native half should be able to say the
// same; a generated loader is a 20k-line blob nobody reads; and the ABI already
// requires the host to hand us a resolver, so the only thing missing was the
// function list — which is spelled once, below.
//
// The list is an X-macro so the declaration, the struct member and the load
// call cannot drift apart.
#pragma once

#include <photon/photon.h>

#include <cstddef>
#include <string>

namespace photon::gl {

// GL's own scalar typedefs, reproduced rather than included. These are fixed by
// the OpenGL ABI on every platform we target.
using GLenum = unsigned int;
using GLboolean = unsigned char;
using GLbitfield = unsigned int;
using GLbyte = signed char;
using GLubyte = unsigned char;
using GLshort = short;
using GLushort = unsigned short;
using GLint = int;
using GLuint = unsigned int;
using GLsizei = int;
using GLfloat = float;
using GLdouble = double;
using GLchar = char;
using GLintptr = std::ptrdiff_t;
using GLsizeiptr = std::ptrdiff_t;

// GL functions are __stdcall on Windows and cdecl everywhere else.
#if defined(_WIN32)
#  define PH_GLAPI __stdcall
#else
#  define PH_GLAPI
#endif

// The constants used by this renderer. Spelled out for the same reason as the
// typedefs — so no GL header is required to build.
enum : GLenum {
  GL_FALSE_ = 0,
  GL_TRUE_ = 1,
  GL_POINTS = 0x0000,
  GL_LINES = 0x0001,
  GL_TRIANGLES = 0x0004,
  GL_TRIANGLE_STRIP = 0x0005,
  GL_TRIANGLE_FAN = 0x0006,
  GL_DEPTH_BUFFER_BIT = 0x00000100,
  GL_COLOR_BUFFER_BIT = 0x00004000,
  GL_SRC_ALPHA = 0x0302,
  GL_ONE_MINUS_SRC_ALPHA = 0x0303,
  GL_ONE = 1,
  GL_ZERO = 0,
  GL_BLEND = 0x0BE2,
  GL_DEPTH_TEST = 0x0B71,
  GL_SCISSOR_TEST = 0x0C11,
  GL_CULL_FACE = 0x0B44,
  GL_MULTISAMPLE = 0x809D,
  GL_TEXTURE_2D = 0x0DE1,
  GL_TEXTURE0 = 0x84C0,
  GL_TEXTURE_MAG_FILTER = 0x2800,
  GL_TEXTURE_MIN_FILTER = 0x2801,
  GL_TEXTURE_WRAP_S = 0x2802,
  GL_TEXTURE_WRAP_T = 0x2803,
  GL_NEAREST = 0x2600,
  GL_LINEAR = 0x2601,
  GL_CLAMP_TO_EDGE = 0x812F,
  GL_RED = 0x1903,
  GL_RGB = 0x1907,
  GL_RGBA = 0x1908,
  GL_RGBA8 = 0x8058,
  GL_R8 = 0x8229,
  GL_UNSIGNED_BYTE = 0x1401,
  GL_FLOAT = 0x1406,
  GL_UNSIGNED_INT = 0x1405,
  GL_ARRAY_BUFFER = 0x8892,
  GL_ELEMENT_ARRAY_BUFFER = 0x8893,
  GL_STATIC_DRAW = 0x88E4,
  GL_DYNAMIC_DRAW = 0x88E8,
  GL_FRAGMENT_SHADER = 0x8B30,
  GL_VERTEX_SHADER = 0x8B31,
  GL_COMPILE_STATUS = 0x8B81,
  GL_LINK_STATUS = 0x8B82,
  GL_INFO_LOG_LENGTH = 0x8B84,
  GL_FRAMEBUFFER = 0x8D40,
  GL_RENDERBUFFER = 0x8D41,
  GL_READ_FRAMEBUFFER = 0x8CA8,
  GL_DRAW_FRAMEBUFFER = 0x8CA9,
  GL_COLOR_ATTACHMENT0 = 0x8CE0,
  GL_DEPTH_STENCIL_ATTACHMENT = 0x821A,
  GL_DEPTH24_STENCIL8 = 0x88F0,
  GL_FRAMEBUFFER_COMPLETE = 0x8CD5,
  GL_FRAMEBUFFER_BINDING = 0x8CA6,
  GL_VIEWPORT = 0x0BA2,
  GL_PACK_ALIGNMENT = 0x0D05,
  GL_UNPACK_ALIGNMENT = 0x0CF5,
  GL_NO_ERROR = 0,
  GL_VERSION = 0x1F02,
  GL_RENDERER = 0x1F01,
  GL_VENDOR = 0x1F00
};

// clang-format off
/// Every GL entry point this renderer uses. Adding one means adding a line here
/// and nothing else.
#define PHOTON_GL_FUNCTIONS(X)                                                                       \
  /* buffers */                                                                                      \
  X(GenBuffers,               void,   (GLsizei n, GLuint* buffers))                                  \
  X(DeleteBuffers,            void,   (GLsizei n, const GLuint* buffers))                            \
  X(BindBuffer,               void,   (GLenum target, GLuint buffer))                                \
  X(BufferData,               void,   (GLenum target, GLsizeiptr size, const void* data, GLenum usage)) \
  X(BufferSubData,            void,   (GLenum target, GLintptr offset, GLsizeiptr size, const void* data)) \
  /* vertex arrays */                                                                                \
  X(GenVertexArrays,          void,   (GLsizei n, GLuint* arrays))                                   \
  X(DeleteVertexArrays,       void,   (GLsizei n, const GLuint* arrays))                             \
  X(BindVertexArray,          void,   (GLuint array))                                                \
  X(EnableVertexAttribArray,  void,   (GLuint index))                                                \
  X(DisableVertexAttribArray, void,   (GLuint index))                                                \
  X(VertexAttribPointer,      void,   (GLuint index, GLint size, GLenum type, GLboolean normalized, GLsizei stride, const void* pointer)) \
  X(VertexAttribDivisor,      void,   (GLuint index, GLuint divisor))                                \
  /* shaders and programs */                                                                         \
  X(CreateShader,             GLuint, (GLenum type))                                                 \
  X(ShaderSource,             void,   (GLuint shader, GLsizei count, const GLchar* const* string, const GLint* length)) \
  X(CompileShader,            void,   (GLuint shader))                                               \
  X(GetShaderiv,              void,   (GLuint shader, GLenum pname, GLint* params))                  \
  X(GetShaderInfoLog,         void,   (GLuint shader, GLsizei bufSize, GLsizei* length, GLchar* infoLog)) \
  X(DeleteShader,             void,   (GLuint shader))                                               \
  X(CreateProgram,            GLuint, (void))                                                        \
  X(AttachShader,             void,   (GLuint program, GLuint shader))                               \
  X(LinkProgram,              void,   (GLuint program))                                              \
  X(GetProgramiv,             void,   (GLuint program, GLenum pname, GLint* params))                 \
  X(GetProgramInfoLog,        void,   (GLuint program, GLsizei bufSize, GLsizei* length, GLchar* infoLog)) \
  X(DeleteProgram,            void,   (GLuint program))                                              \
  X(UseProgram,               void,   (GLuint program))                                              \
  X(GetUniformLocation,       GLint,  (GLuint program, const GLchar* name))                          \
  /* uniforms */                                                                                     \
  X(Uniform1i,                void,   (GLint location, GLint v0))                                    \
  X(Uniform1f,                void,   (GLint location, GLfloat v0))                                  \
  X(Uniform2f,                void,   (GLint location, GLfloat v0, GLfloat v1))                      \
  X(Uniform3f,                void,   (GLint location, GLfloat v0, GLfloat v1, GLfloat v2))          \
  X(Uniform4f,                void,   (GLint location, GLfloat v0, GLfloat v1, GLfloat v2, GLfloat v3)) \
  X(Uniform1fv,               void,   (GLint location, GLsizei count, const GLfloat* value))         \
  /* drawing */                                                                                      \
  X(DrawArrays,               void,   (GLenum mode, GLint first, GLsizei count))                     \
  X(DrawArraysInstanced,      void,   (GLenum mode, GLint first, GLsizei count, GLsizei instancecount)) \
  X(DrawElements,             void,   (GLenum mode, GLsizei count, GLenum type, const void* indices)) \
  /* state */                                                                                        \
  X(Viewport,                 void,   (GLint x, GLint y, GLsizei width, GLsizei height))             \
  X(Scissor,                  void,   (GLint x, GLint y, GLsizei width, GLsizei height))             \
  X(Enable,                   void,   (GLenum cap))                                                  \
  X(Disable,                  void,   (GLenum cap))                                                  \
  X(BlendFunc,                void,   (GLenum sfactor, GLenum dfactor))                              \
  X(ClearColor,               void,   (GLfloat r, GLfloat g, GLfloat b, GLfloat a))                  \
  X(Clear,                    void,   (GLbitfield mask))                                             \
  X(GetError,                 GLenum, (void))                                                        \
  X(GetString,                const GLubyte*, (GLenum name))                                         \
  X(GetIntegerv,              void,   (GLenum pname, GLint* data))                                   \
  X(PixelStorei,              void,   (GLenum pname, GLint param))                                   \
  /* textures */                                                                                     \
  X(GenTextures,              void,   (GLsizei n, GLuint* textures))                                 \
  X(DeleteTextures,           void,   (GLsizei n, const GLuint* textures))                           \
  X(BindTexture,              void,   (GLenum target, GLuint texture))                               \
  X(ActiveTexture,            void,   (GLenum texture))                                              \
  X(TexImage2D,               void,   (GLenum target, GLint level, GLint internalformat, GLsizei width, GLsizei height, GLint border, GLenum format, GLenum type, const void* pixels)) \
  X(TexSubImage2D,            void,   (GLenum target, GLint level, GLint xoffset, GLint yoffset, GLsizei width, GLsizei height, GLenum format, GLenum type, const void* pixels)) \
  X(TexParameteri,            void,   (GLenum target, GLenum pname, GLint param))                    \
  /* framebuffers — the offscreen readback path */                                                   \
  X(GenFramebuffers,          void,   (GLsizei n, GLuint* framebuffers))                             \
  X(DeleteFramebuffers,       void,   (GLsizei n, const GLuint* framebuffers))                       \
  X(BindFramebuffer,          void,   (GLenum target, GLuint framebuffer))                           \
  X(FramebufferTexture2D,     void,   (GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level)) \
  X(FramebufferRenderbuffer,  void,   (GLenum target, GLenum attachment, GLenum renderbuffertarget, GLuint renderbuffer)) \
  X(CheckFramebufferStatus,   GLenum, (GLenum target))                                               \
  X(GenRenderbuffers,         void,   (GLsizei n, GLuint* renderbuffers))                            \
  X(DeleteRenderbuffers,      void,   (GLsizei n, const GLuint* renderbuffers))                      \
  X(BindRenderbuffer,         void,   (GLenum target, GLuint renderbuffer))                          \
  X(RenderbufferStorage,      void,   (GLenum target, GLenum internalformat, GLsizei width, GLsizei height)) \
  X(ReadPixels,               void,   (GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void* pixels)) \
  X(BlitFramebuffer,          void,   (GLint srcX0, GLint srcY0, GLint srcX1, GLint srcY1, GLint dstX0, GLint dstY0, GLint dstX1, GLint dstY1, GLbitfield mask, GLenum filter))
// clang-format on

/// The resolved entry points. One instance lives in the Registry.
struct Api {
#define PHOTON_GL_DECLARE(name, ret, args) ret(PH_GLAPI* name) args = nullptr;
  PHOTON_GL_FUNCTIONS(PHOTON_GL_DECLARE)
#undef PHOTON_GL_DECLARE

  /// True once load() has succeeded.
  bool ready = false;
};

/**
 * Resolve every entry point through `get`.
 *
 * On failure `error` names the functions that could not be resolved rather than
 * just saying "GL 3.3 required" — a driver that is missing exactly one entry
 * point is a real situation, and the name is the whole diagnosis.
 */
bool load(Api& api, ph_proc_address_fn get, void* user, std::string& error);

}  // namespace photon::gl

// The single translation unit that instantiates stb_truetype.
//
// It is alone in this file because the library is vendored verbatim and does not
// compile clean under the warning set the rest of the engine builds with
// (-Wconversion, -Wsign-conversion, /W4). CMake turns warnings off for this one
// source rather than patching upstream — a patched stb is a stb that cannot be
// updated.
#define STB_TRUETYPE_IMPLEMENTATION
#include <stb_truetype.h>

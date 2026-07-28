# Two test binaries, deliberately in two languages.
#
# abi_c_test compiles as C99 and is the tripwire for anything C++-only sneaking
# into photon.h — it sees the ABI exactly the way P/Invoke, Panama and a Qt host
# see it. interaction_test is C++ and checks the ported math against the numbers
# core/src/plot.ts produces.

add_executable(photon_abi_c_test abi_c_test.c)
set_target_properties(photon_abi_c_test PROPERTIES
  # Force C, so a stray C++ construct in the public header fails the build here
  # rather than in a binding six months from now.
  LINKER_LANGUAGE CXX
  C_STANDARD 99
  C_STANDARD_REQUIRED ON
  C_EXTENSIONS OFF
)
target_link_libraries(photon_abi_c_test PRIVATE photon)
target_include_directories(photon_abi_c_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

add_executable(photon_interaction_test interaction_test.cpp)
target_link_libraries(photon_interaction_test PRIVATE photon)
target_include_directories(photon_interaction_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

if(MSVC)
  target_compile_options(photon_abi_c_test PRIVATE /W4 /utf-8)
  target_compile_options(photon_interaction_test PRIVATE /W4 /utf-8)
else()
  target_compile_options(photon_abi_c_test PRIVATE -Wall -Wextra)
  target_compile_options(photon_interaction_test PRIVATE -Wall -Wextra)
endif()

# Scales and ticks are internal, so this one links the static twin rather than
# the ph_*-only shared library.
add_executable(photon_scale_test scale_test.cpp)
target_link_libraries(photon_scale_test PRIVATE photon_internal)
target_include_directories(photon_scale_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
if(MSVC)
  target_compile_options(photon_scale_test PRIVATE /W4 /utf-8)
else()
  target_compile_options(photon_scale_test PRIVATE -Wall -Wextra)
endif()

add_test(NAME abi_c COMMAND photon_abi_c_test)
add_test(NAME interaction COMMAND photon_interaction_test)
add_test(NAME scales COMMAND photon_scale_test)

# The only test that compiles a shader. It needs a real GL 3.3 core context,
# which it gets surfacelessly through EGL — no display server, so it runs in CI.
# Where EGL is absent the test is simply not built; where EGL exists but cannot
# produce a core context, the binary exits 77 and ctest records a skip.
find_library(PHOTON_EGL_LIBRARY NAMES EGL)
find_path(PHOTON_EGL_INCLUDE_DIR NAMES EGL/egl.h)
if(PHOTON_EGL_LIBRARY AND PHOTON_EGL_INCLUDE_DIR)
  add_executable(photon_gl_smoke_test gl_smoke_test.c)
  set_target_properties(photon_gl_smoke_test PROPERTIES
    LINKER_LANGUAGE CXX C_STANDARD 99 C_STANDARD_REQUIRED ON C_EXTENSIONS OFF)
  target_link_libraries(photon_gl_smoke_test PRIVATE photon ${PHOTON_EGL_LIBRARY})
  target_include_directories(photon_gl_smoke_test
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${PHOTON_EGL_INCLUDE_DIR})
  if(NOT MSVC)
    target_compile_options(photon_gl_smoke_test PRIVATE -Wall -Wextra)
  endif()
  add_test(NAME gl_smoke COMMAND photon_gl_smoke_test)
  # Creating a GL context allocates inside the driver — libEGL, libGLdispatch,
  # libnvidia-glsi and (through them) libdbus all hold memory until the process
  # exits. LeakSanitizer reports those as leaks, from stack frames inside
  # closed-source libraries that a suppression file cannot reliably match.
  #
  # So leak detection is off for this test alone. ASan's other checks — use
  # after free, buffer overflow, the ones that would catch a bug in the layer
  # code this test exists to exercise — all still run, and the other three
  # tests keep full leak detection.
  set_tests_properties(gl_smoke PROPERTIES
    SKIP_RETURN_CODE 77
    ENVIRONMENT "ASAN_OPTIONS=detect_leaks=0")
else()
  message(STATUS "EGL not found — the headless GL smoke test will not be built")
endif()

# On Windows the DLL has to sit next to the .exe or beside it on PATH; copying is
# simpler than teaching ctest about the search path.
if(WIN32 AND PHOTON_BUILD_SHARED)
  foreach(target photon_abi_c_test photon_interaction_test)
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_if_different
              $<TARGET_FILE:photon> $<TARGET_FILE_DIR:${target}>
    )
  endforeach()
endif()

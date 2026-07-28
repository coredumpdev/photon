cmake_minimum_required(VERSION 3.24)

project(photon_native
  VERSION 0.7.2
  DESCRIPTION "GPU-accelerated scientific charting — native core and C ABI"
  LANGUAGES C CXX
)

# Standalone vs. add_subdirectory: only the top-level project gets to set global
# defaults or install anything.
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
  set(PHOTON_IS_TOP_LEVEL ON)
else()
  set(PHOTON_IS_TOP_LEVEL OFF)
endif()

option(PHOTON_BUILD_SHARED "Build libphoton as a shared library" ON)
option(PHOTON_BUILD_TESTS  "Build the ABI conformance and interaction tests" ${PHOTON_IS_TOP_LEVEL})
option(PHOTON_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" OFF)

# Faz 1 lands the GL backend and a GLFW host; the option exists now so the
# build graph does not have to be reshaped later.
option(PHOTON_BUILD_GLFW_HOST "Build the standalone GLFW host (Faz 1)" OFF)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(PHOTON_IS_TOP_LEVEL)
  # Bindings dlopen/LoadLibrary this, so everything must be relocatable.
  set(CMAKE_POSITION_INDEPENDENT_CODE ON)
  # Hide everything that the ABI header does not explicitly export. Without this
  # a Linux .so leaks every C++ symbol and can collide with a host's own STL.
  set(CMAKE_C_VISIBILITY_PRESET hidden)
  set(CMAKE_CXX_VISIBILITY_PRESET hidden)
  set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
  set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
  if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
  endif()
  # Keep every artifact in one place; a host binding only has to look in one dir.
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
  set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
  set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
endif()

# ---------------------------------------------------------------------------
# libphoton
# ---------------------------------------------------------------------------

set(PHOTON_SOURCES
  src/abi.cpp
  src/error.cpp
  src/layer.cpp
  src/plot.cpp
  src/registry.cpp
  src/scale.cpp
  src/axes/ticks.cpp
  src/gl/gl.cpp
  src/gl/program.cpp
  src/gl/transform.cpp
)

if(PHOTON_BUILD_SHARED)
  add_library(photon SHARED ${PHOTON_SOURCES})
else()
  add_library(photon STATIC ${PHOTON_SOURCES})
endif()
add_library(photon::photon ALIAS photon)

target_include_directories(photon
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

# PHOTON_BUILD_SHARED switches the header's PH_API to dllexport on Windows and
# to default-visibility elsewhere. Consumers of the shared library define
# PHOTON_USE_SHARED instead, which the INTERFACE half below hands them.
if(PHOTON_BUILD_SHARED)
  target_compile_definitions(photon
    PRIVATE   PHOTON_BUILD_SHARED
    INTERFACE PHOTON_USE_SHARED
  )
endif()

set_target_properties(photon PROPERTIES
  VERSION   ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR}
  OUTPUT_NAME photon
  # Keep the file name predictable across platforms: bindings hard-code it.
  # libphoton.so / libphoton.dylib / photon.dll
  PREFIX "${CMAKE_SHARED_LIBRARY_PREFIX}"
)

if(MSVC)
  target_compile_options(photon PRIVATE /W4 /utf-8 /permissive- /Zc:__cplusplus)
  target_compile_definitions(photon PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
  if(PHOTON_WARNINGS_AS_ERRORS)
    target_compile_options(photon PRIVATE /WX)
  endif()
else()
  target_compile_options(photon PRIVATE
    -Wall -Wextra -Wpedantic
    -Wshadow -Wconversion -Wsign-conversion
    # An exception escaping into a C caller is undefined behaviour, and this is
    # the only warning that catches it at the ABI boundary.
    -Wno-unused-parameter
  )
  if(PHOTON_WARNINGS_AS_ERRORS)
    target_compile_options(photon PRIVATE -Werror)
  endif()
endif()

# macOS: bindings load the dylib by name from alongside the host binary.
if(APPLE)
  set_target_properties(photon PROPERTIES
    MACOSX_RPATH ON
    INSTALL_NAME_DIR "@rpath"
  )
endif()

# Restrict the dynamic symbol table to ph_* — see cmake/photon.map for why
# -fvisibility=hidden is not sufficient on its own. Windows needs nothing here:
# __declspec(dllexport) is already an allowlist.
if(PHOTON_BUILD_SHARED AND NOT WIN32)
  if(APPLE)
    set(PHOTON_SYMBOL_LIST "${CMAKE_CURRENT_SOURCE_DIR}/cmake/photon.symbols")
    target_link_options(photon PRIVATE "-Wl,-exported_symbols_list,${PHOTON_SYMBOL_LIST}")
    set_property(TARGET photon APPEND PROPERTY LINK_DEPENDS "${PHOTON_SYMBOL_LIST}")
  else()
    include(CheckLinkerFlag)
    set(PHOTON_VERSION_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/cmake/photon.map")
    check_linker_flag(CXX "-Wl,--version-script=${PHOTON_VERSION_SCRIPT}" PHOTON_HAVE_VERSION_SCRIPT)
    if(PHOTON_HAVE_VERSION_SCRIPT)
      target_link_options(photon PRIVATE "-Wl,--version-script=${PHOTON_VERSION_SCRIPT}")
      set_property(TARGET photon APPEND PROPERTY LINK_DEPENDS "${PHOTON_VERSION_SCRIPT}")
    else()
      message(WARNING "Linker has no --version-script: libphoton will re-export weak libstdc++ symbols.")
    endif()
  endif()
endif()

find_package(Threads REQUIRED)
target_link_libraries(photon PRIVATE Threads::Threads)

# The shared library exports only ph_*, which is right for hosts and useless for
# testing the internals (Scale, tick generation, the layout math). This static
# twin exists so those tests can link the real code rather than a copy of it.
if(PHOTON_BUILD_TESTS)
  add_library(photon_internal STATIC EXCLUDE_FROM_ALL ${PHOTON_SOURCES})
  target_include_directories(photon_internal
    PUBLIC
      ${CMAKE_CURRENT_SOURCE_DIR}/include
      ${CMAKE_CURRENT_SOURCE_DIR}/src
  )
  target_link_libraries(photon_internal PRIVATE Threads::Threads)
  if(MSVC)
    target_compile_options(photon_internal PRIVATE /W4 /utf-8 /permissive-)
    target_compile_definitions(photon_internal PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
  else()
    target_compile_options(photon_internal PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion)
  endif()
endif()

# ---------------------------------------------------------------------------
# Hosts (Faz 1)
# ---------------------------------------------------------------------------

if(PHOTON_BUILD_GLFW_HOST)
  message(FATAL_ERROR
    "PHOTON_BUILD_GLFW_HOST is reserved for Faz 1. The GL backend does not exist yet; "
    "turning this on now would build a window that renders nothing.")
endif()

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

if(PHOTON_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

if(PHOTON_IS_TOP_LEVEL)
  include(GNUInstallDirs)
  include(CMakePackageConfigHelpers)

  install(TARGETS photon
    EXPORT photonTargets
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  )
  install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

  install(EXPORT photonTargets
    FILE photonTargets.cmake
    NAMESPACE photon::
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/photon
  )

  write_basic_package_version_file(
    "${CMAKE_CURRENT_BINARY_DIR}/photonConfigVersion.cmake"
    VERSION ${PROJECT_VERSION}
    COMPATIBILITY SameMajorVersion
  )
  configure_package_config_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/cmake/photonConfig.cmake.in"
    "${CMAKE_CURRENT_BINARY_DIR}/photonConfig.cmake"
    INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/photon
  )
  install(FILES
    "${CMAKE_CURRENT_BINARY_DIR}/photonConfig.cmake"
    "${CMAKE_CURRENT_BINARY_DIR}/photonConfigVersion.cmake"
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/photon
  )
endif()

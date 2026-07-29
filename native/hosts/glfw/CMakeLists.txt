# The GLFW host and the gallery that drives it.
#
# GLFW is fetched rather than found: the rest of this build needs nothing
# installed, and a host that only exists to demonstrate the ABI should not be
# the reason someone has to install a system package first. Everything here is
# behind PHOTON_BUILD_GLFW_HOST, which is off by default, so the library and its
# tests still build with no network.

include(FetchContent)

set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)

FetchContent_Declare(glfw
  GIT_REPOSITORY https://github.com/glfw/glfw.git
  GIT_TAG        3.4
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(glfw)

add_library(photon_glfw STATIC photon_glfw.c)
target_link_libraries(photon_glfw PUBLIC photon::photon glfw)
target_include_directories(photon_glfw PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

add_executable(photon_gallery gallery.c)
target_link_libraries(photon_gallery PRIVATE photon_glfw photon_panels)

if(MSVC)
  target_compile_options(photon_glfw PRIVATE /W4 /utf-8)
  target_compile_options(photon_gallery PRIVATE /W4 /utf-8)
else()
  target_compile_options(photon_glfw PRIVATE -Wall -Wextra -Wpedantic)
  target_compile_options(photon_gallery PRIVATE -Wall -Wextra -Wpedantic)
  target_link_libraries(photon_glfw PRIVATE m)
endif()

# On Windows the DLL has to sit beside the .exe.
if(WIN32 AND PHOTON_BUILD_SHARED)
  add_custom_command(TARGET photon_gallery POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:photon> $<TARGET_FILE_DIR:photon_gallery>
  )
endif()

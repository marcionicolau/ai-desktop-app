cmake_minimum_required(VERSION 3.16)
project(llama_shim C CXX)

# llama.cpp options: shared libs so bun:ffi can dlopen them; skip binaries we
# do not ship inside the desktop bundle.
set(BUILD_SHARED_LIBS ON)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
# Packaged builds run on arbitrary hosts: compile one ggml CPU backend
# per ISA variant (libggml-cpu-<arch>.so) and let ggml pick at runtime —
# -march=native here produced AVX-512 code in CI that SIGILLs on older
# CPUs. GGML_NATIVE must be OFF with BACKEND_DL (cmake enforces it).
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL ON CACHE BOOL "" FORCE)
set(GGML_CPU_ALL_VARIANTS ON CACHE BOOL "" FORCE)

if(UNIX AND NOT APPLE)
    # applies to every target created below — incl. the variant
    # libs, which link ggml-base and must resolve it via $ORIGIN
    set(CMAKE_BUILD_RPATH "$ORIGIN")
    set(CMAKE_INSTALL_RPATH "$ORIGIN")
endif()

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../vendor/llama.cpp
                 ${CMAKE_BINARY_DIR}/llama.cpp
                 EXCLUDE_FROM_ALL)

add_library(llama_shim SHARED llama_shim.c)
target_include_directories(llama_shim PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/llama.cpp/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/llama.cpp/ggml/include)
target_link_libraries(llama_shim PRIVATE llama)

# feature 023: script_shim — embedded script-runtime prototype.
# python side needs only libdl (dlopens libpython RTLD_GLOBAL at
# runtime); the R side links libR, so the target builds only when
# R headers+lib are present — benchmark records "missing" otherwise.
find_path(R_INCLUDE_DIR R.h PATHS /usr/include/R /usr/lib64/R/include
    /usr/local/lib/R/include /opt/homebrew/lib/R/include
    /Library/Frameworks/R.framework/Headers)
find_library(R_LIBRARY NAMES R libR PATHS /usr/lib64/R/lib
    /usr/lib/R/lib /usr/local/lib/R/lib /opt/homebrew/lib/R/lib
    /Library/Frameworks/R.framework/Libraries)
if(R_INCLUDE_DIR AND R_LIBRARY)
    add_library(script_shim SHARED script_shim.c)
    target_include_directories(script_shim PRIVATE ${R_INCLUDE_DIR})
    target_link_libraries(script_shim PRIVATE ${R_LIBRARY} ${CMAKE_DL_LIBS})
    if(UNIX AND NOT APPLE)
        set_target_properties(script_shim PROPERTIES
            BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
    endif()
else()
    message(STATUS "script_shim: R headers/lib not found — embedded prototype unavailable")
endif()

if(APPLE)
    # runtime must find libllama/libggml next to the shim inside the bundle
    set_target_properties(llama_shim PROPERTIES
        INSTALL_RPATH "@loader_path"
        BUILD_WITH_INSTALL_RPATH TRUE)
    foreach(t llama ggml ggml-base ggml-cpu)
        if(TARGET ${t})
            set_target_properties(${t} PROPERTIES
                INSTALL_NAME_DIR "@rpath"
                INSTALL_RPATH "@loader_path")
        endif()
    endforeach()
elseif(UNIX)
    # FR-008: $ORIGIN so the shim + ggml/llama resolve their deps next to
    # themselves — in the cmake bin/ dir AND in the packaged bundle —
    # never from an absolute build-tree path baked at compile time.
    foreach(t llama_shim llama ggml ggml-base ggml-cpu)
        if(TARGET ${t})
            set_target_properties(${t} PROPERTIES
                BUILD_RPATH "$ORIGIN"
                INSTALL_RPATH "$ORIGIN")
        endif()
    endforeach()
endif()

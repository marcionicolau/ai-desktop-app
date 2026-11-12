cmake_minimum_required(VERSION 3.16)
project(llama_shim C CXX)

# llama.cpp options: shared libs so bun:ffi can dlopen them; skip binaries we
# do not ship inside the desktop bundle.
set(BUILD_SHARED_LIBS ON)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GGML_BACKEND_DL OFF CACHE BOOL "" FORCE)

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../vendor/llama.cpp
                 ${CMAKE_BINARY_DIR}/llama.cpp
                 EXCLUDE_FROM_ALL)

add_library(llama_shim SHARED llama_shim.c)
target_include_directories(llama_shim PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/llama.cpp/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../vendor/llama.cpp/ggml/include)
target_link_libraries(llama_shim PRIVATE llama)

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

# Setting Up the Rust Development Environment for Phase 3

This guide will help you set up the Rust development environment needed for the Phase 3 WebAssembly (WASM) physics engine. This advanced physics module will provide a significant performance boost for the WASM/SIMD Physics Test in our benchmark gauntlet.

## Background

As part of Phase 3 ("The Next Frontier"), we're developing a hyper-optimized physics simulation in Rust that will be compiled to WebAssembly. This will serve as a bonus test to measure raw, single-threaded CPU performance, leveraging SIMD instructions where available.

## Step 1: Install Rust via `rustup`

The recommended way to install Rust is through `rustup`, the Rust toolchain installer.

1.  **Visit the official Rust website:** [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
2.  Follow the instructions for your operating system (Windows, macOS, Linux). The website will provide you with a command to run in your terminal.
3.  During the installation, you can proceed with the default options.
4.  After installation is complete, close and reopen your terminal to ensure the `cargo` command is available in your system's PATH.

You can verify the installation by running:
```
cargo --version
```

## Step 2: Install `wasm-pack`

`wasm-pack` is the tool used to build, test, and publish Rust-generated WebAssembly. Once `cargo` is installed, you can install `wasm-pack` by running the following command in your terminal:

```
cargo install wasm-pack
```

You can verify the installation by running:
```
wasm-pack --version
```

## Step 3: Install WebAssembly Target

Add the WebAssembly target to your Rust toolchain:

```
rustup target add wasm32-unknown-unknown
```

## Integration with Nebula AUSP

The WASM physics module will be integrated into the existing application as follows:

1. **Module Structure:** The Rust code will live in a separate `/rust` directory at the root of the project.

2. **Build Process:** We'll use `wasm-pack` to compile the Rust code to WebAssembly and generate the necessary JavaScript bindings.

3. **Runtime Detection:** The application will detect if the browser supports WASM SIMD instructions and only run the advanced test if supported.

4. **Performance Comparison:** The benchmark will run both the JavaScript and WASM versions of the physics simulation to provide a direct comparison of performance.

## Next Steps

Once you have successfully installed both `cargo` and `wasm-pack`, we can proceed with creating the new Rust-based physics module. The initial implementation will focus on a simplified version of our N-body simulation, optimized for single-threaded performance and SIMD instructions.

This will be a key component of our Phase 3 roadmap, pushing the boundaries of what's possible in web-based benchmarking. 
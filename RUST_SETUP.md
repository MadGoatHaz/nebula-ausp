# Setting Up the Rust Development Environment

To build the new WebAssembly (WASM) based physics engine for Project Nebula, you need to install the Rust programming language and the `wasm-pack` tool.

## Step 1: Install Rust via `rustup`

The recommended way to install Rust is through `rustup`, the Rust toolchain installer.

1.  **Visit the official Rust website:** [https://www.rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)
2.  Follow the instructions for your operating system (Windows, macOS, Linux). The website will provide you with a command to run in your terminal.
3.  During the installation, you can proceed with the default options.
4.  After installation is complete, close and reopen your terminal to ensure the `cargo` command is available in your system's PATH.

You can verify the installation by running:
`cargo --version`

## Step 2: Install `wasm-pack`

`wasm-pack` is the tool used to build, test, and publish Rust-generated WebAssembly. Once `cargo` is installed, you can install `wasm-pack` by running the following command in your terminal:

`cargo install wasm-pack`

You can verify the installation by running:
`wasm-pack --version`

## Next Steps

Once you have successfully installed both `cargo` and `wasm-pack`, let me know, and I will proceed with creating the new Rust-based physics module for the project. 
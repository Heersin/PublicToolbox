use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn reverse_text(input: &str) -> String {
    tool_core::reverse_text(input)
}

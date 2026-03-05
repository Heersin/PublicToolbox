/// Reverse text by Unicode scalar values for deterministic behavior across targets.
#[must_use]
pub fn reverse_text(input: &str) -> String {
    input.chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::reverse_text;

    #[test]
    fn reverses_ascii_text() {
        assert_eq!(reverse_text("abc"), "cba");
    }

    #[test]
    fn reverses_multibyte_text() {
        assert_eq!(reverse_text("书简"), "简书");
    }
}

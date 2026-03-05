/// Reverse text by Unicode scalar values for deterministic behavior across targets.
#[must_use]
pub fn reverse_text(input: &str) -> String {
    input.chars().rev().collect()
}

/// Count non-empty words split by unicode whitespace.
#[must_use]
pub fn count_words(input: &str) -> usize {
    input.split_whitespace().filter(|segment| !segment.is_empty()).count()
}

#[cfg(test)]
mod tests {
    use super::{count_words, reverse_text};

    #[test]
    fn reverses_ascii_text() {
        assert_eq!(reverse_text("abc"), "cba");
    }

    #[test]
    fn reverses_multibyte_text() {
        assert_eq!(reverse_text("书简"), "简书");
    }

    #[test]
    fn counts_words() {
      assert_eq!(count_words("ink over paper"), 3);
      assert_eq!(count_words("  mixed\n spacing\t "), 2);
    }
}

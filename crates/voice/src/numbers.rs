//! Numbers to English words (what Misaki gets from `num2words`), for the cases game lines use:
//! cardinals, ordinals, years and simple decimals.

const ONES: [&str; 20] = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
    "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [(u64, &str); 4] = [
    (1_000_000_000_000, "trillion"),
    (1_000_000_000, "billion"),
    (1_000_000, "million"),
    (1_000, "thousand"),
];

/// "one hundred and twenty-three" style, as `num2words` writes it.
pub fn cardinal(n: u64) -> String {
    if n < 20 {
        return ONES[n as usize].to_owned();
    }
    if n < 100 {
        let (t, o) = (n / 10, n % 10);
        return if o == 0 { TENS[t as usize].to_owned() } else { format!("{}-{}", TENS[t as usize], ONES[o as usize]) };
    }
    if n < 1000 {
        let (h, rest) = (n / 100, n % 100);
        let head = format!("{} hundred", ONES[h as usize]);
        return if rest == 0 { head } else { format!("{head} and {}", cardinal(rest)) };
    }
    for (scale, name) in SCALES {
        if n >= scale {
            let (head, rest) = (n / scale, n % scale);
            let head = format!("{} {name}", cardinal(head));
            return match rest {
                0 => head,
                r if r < 100 => format!("{head} and {}", cardinal(r)),
                r => format!("{head}, {}", cardinal(r)),
            };
        }
    }
    unreachable!()
}

/// "twenty-first", "one hundredth".
pub fn ordinal(n: u64) -> String {
    let words = cardinal(n);
    let (head, last) = match words.rfind([' ', '-']) {
        Some(i) => words.split_at(i + 1),
        None => ("", words.as_str()),
    };
    let last = match last {
        "one" => "first".to_owned(),
        "two" => "second".to_owned(),
        "three" => "third".to_owned(),
        "five" => "fifth".to_owned(),
        "eight" => "eighth".to_owned(),
        "nine" => "ninth".to_owned(),
        "twelve" => "twelfth".to_owned(),
        w if w.ends_with('y') => format!("{}ieth", &w[..w.len() - 1]),
        w => format!("{w}th"),
    };
    format!("{head}{last}")
}

/// "nineteen eighty-four", "two thousand and five", "twenty twenty-six".
pub fn year(n: u64) -> String {
    let (hi, lo) = (n / 100, n % 100);
    if !(1000..10000).contains(&n) || (hi % 10 == 0 && lo < 10) {
        return cardinal(n);
    }
    match lo {
        0 => format!("{} hundred", cardinal(hi)),
        1..=9 => format!("{} oh {}", cardinal(hi), cardinal(lo)),
        _ => format!("{} {}", cardinal(hi), cardinal(lo)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words() {
        assert_eq!(cardinal(0), "zero");
        assert_eq!(cardinal(28), "twenty-eight");
        assert_eq!(cardinal(105), "one hundred and five");
        assert_eq!(cardinal(1999), "one thousand, nine hundred and ninety-nine");
        assert_eq!(cardinal(2005), "two thousand and five");
        assert_eq!(ordinal(1), "first");
        assert_eq!(ordinal(22), "twenty-second");
        assert_eq!(ordinal(40), "fortieth");
        assert_eq!(year(1984), "nineteen eighty-four");
        assert_eq!(year(2005), "two thousand and five");
        assert_eq!(year(2026), "twenty twenty-six");
        assert_eq!(year(1900), "nineteen hundred");
    }
}

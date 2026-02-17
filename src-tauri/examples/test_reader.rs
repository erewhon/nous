use std::io::Cursor;

fn main() {
    let path = std::env::args().nth(1).expect("Usage: test_reader <html_file>");
    let bytes = std::fs::read(&path).expect("Failed to read file");
    let url = reqwest::Url::parse("file:///test.html").unwrap();
    let mut cursor = Cursor::new(&bytes);
    let product = readability::extractor::extract(&mut cursor, &url).unwrap();
    println!("=== TITLE ===");
    println!("{}", product.title);
    println!("=== CONTENT LENGTH ===");
    println!("{}", product.content.len());

    // Dump full content
    println!("=== FULL CONTENT ===");
    println!("{}", product.content);
}

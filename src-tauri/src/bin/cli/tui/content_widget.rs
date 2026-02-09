use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use super::app_state::{Mode, TuiState};

pub fn draw(f: &mut Frame, area: Rect, state: &TuiState) {
    let is_active = state.mode == Mode::Content;

    let title = if state.content_title.is_empty() {
        " Page Content ".to_string()
    } else {
        format!(" {} ", state.content_title)
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(if is_active {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    if state.rendered_lines.is_empty() {
        let help_text = vec![
            Line::from(""),
            Line::from(Span::styled(
                "  Select a page from the tree to view its content.",
                Style::default().fg(Color::DarkGray),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  Navigate with j/k, open with Enter or l.",
                Style::default().fg(Color::DarkGray),
            )),
        ];
        let paragraph = Paragraph::new(help_text).block(block);
        f.render_widget(paragraph, area);
    } else {
        let text: Vec<Line> = state.rendered_lines.iter()
            .skip(state.content_scroll)
            .map(|line| {
                // Simple colorization based on content
                if line.starts_with('#') {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD)))
                } else if line.starts_with("> ") || line.starts_with("\u{2502} ") {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC)))
                } else if line.starts_with("```") {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::Cyan)))
                } else if line.starts_with("[x]") || line.starts_with("[ ]") {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::Green)))
                } else if line.starts_with("\u{2022} ") {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::White)))
                } else if line == "~~~" {
                    Line::from(Span::styled(line.clone(), Style::default().fg(Color::DarkGray)))
                } else {
                    Line::from(line.clone())
                }
            })
            .collect();

        let paragraph = Paragraph::new(text)
            .block(block)
            .wrap(Wrap { trim: false });

        f.render_widget(paragraph, area);
    }
}

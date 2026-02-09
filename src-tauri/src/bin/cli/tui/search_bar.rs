use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph};

use super::app_state::TuiState;

pub fn draw(f: &mut Frame, area: Rect, state: &TuiState) {
    // Search input line at the bottom
    let input_area = Rect {
        x: area.x,
        y: area.y + area.height.saturating_sub(1),
        width: area.width,
        height: 1,
    };

    let input_text = format!("/{}", state.search_input);
    let input_widget = Paragraph::new(input_text)
        .style(Style::default().fg(Color::Yellow));
    f.render_widget(input_widget, input_area);

    // Search results overlay above the input
    if !state.search_results.is_empty() {
        let max_results = 10.min(state.search_results.len());
        let results_height = max_results as u16 + 2; // +2 for borders

        let results_area = Rect {
            x: area.x + 1,
            y: area.y + area.height.saturating_sub(results_height + 1),
            width: area.width.saturating_sub(2),
            height: results_height,
        };

        // Clear the area behind the popup
        f.render_widget(Clear, results_area);

        let items: Vec<ListItem> = state.search_results.iter()
            .take(max_results)
            .map(|r| {
                let text = format!("{} ({})", r.title, r.page_type);
                ListItem::new(text)
            })
            .collect();

        let results_block = Block::default()
            .title(" Search Results ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Yellow));

        let results_list = List::new(items)
            .block(results_block)
            .highlight_style(
                Style::default()
                    .bg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            )
            .highlight_symbol("> ");

        let mut list_state = ListState::default();
        list_state.select(Some(state.search_selected));

        f.render_stateful_widget(results_list, results_area, &mut list_state);
    }

    // Set cursor position
    let cursor_x = area.x + 1 + state.search_input.len() as u16;
    let cursor_y = area.y + area.height.saturating_sub(1);
    f.set_cursor_position(Position::new(cursor_x, cursor_y));
}

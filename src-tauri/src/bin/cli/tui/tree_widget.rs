use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, List, ListItem, ListState};

use super::app_state::{Mode, TreeItemKind, TuiState};

pub fn draw(f: &mut Frame, area: Rect, state: &mut TuiState) {
    let is_active = state.mode == Mode::Tree;

    let block = Block::default()
        .title(" Notebooks ")
        .borders(Borders::ALL)
        .border_style(if is_active {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    let items: Vec<ListItem> = state.tree_items.iter().map(|item| {
        let indent = "  ".repeat(item.depth);

        let (prefix, style) = match &item.kind {
            TreeItemKind::Notebook { .. } => {
                let arrow = if item.expanded { "\u{25be} " } else { "\u{25b8} " };
                (arrow.to_string(), Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))
            }
            TreeItemKind::Section { .. } => {
                let arrow = if item.expanded { "\u{25be} " } else { "\u{25b8} " };
                (arrow.to_string(), Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD))
            }
            TreeItemKind::Folder { .. } => {
                let arrow = if item.expanded { "\u{25be} " } else { "\u{25b8} " };
                (arrow.to_string(), Style::default().fg(Color::Blue))
            }
            TreeItemKind::Page { .. } => {
                ("\u{2022} ".to_string(), Style::default().fg(Color::White))
            }
        };

        let text = format!("{}{}{}", indent, prefix, item.label);
        ListItem::new(text).style(style)
    }).collect();

    let list = List::new(items)
        .block(block)
        .highlight_style(
            Style::default()
                .bg(if is_active { Color::DarkGray } else { Color::Black })
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("> ");

    let mut list_state = ListState::default();
    list_state.select(Some(state.tree_selected));

    f.render_stateful_widget(list, area, &mut list_state);
}

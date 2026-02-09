use ratatui::prelude::*;
use ratatui::layout::{Constraint, Direction, Layout};

use super::app_state::{Mode, TuiState};
use super::{content_widget, search_bar, status_bar, tree_widget};

pub fn draw(f: &mut Frame, state: &mut TuiState) {
    let size = f.area();

    // Main layout: content area + status bar
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(3),
            Constraint::Length(1),
        ])
        .split(size);

    let main_area = outer[0];
    let status_area = outer[1];

    // Horizontal split: tree (30%) | content (70%)
    let panels = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(30),
            Constraint::Percentage(70),
        ])
        .split(main_area);

    let tree_area = panels[0];
    let content_area = panels[1];

    // Save areas for mouse hit-testing
    state.tree_area = Some(tree_area);
    state.content_area = Some(content_area);

    // Draw panels
    tree_widget::draw(f, tree_area, state);
    content_widget::draw(f, content_area, state);

    // Draw status bar or search overlay
    if state.mode == Mode::Search {
        search_bar::draw(f, size, state);
    } else {
        status_bar::draw(f, status_area, state);
    }
}

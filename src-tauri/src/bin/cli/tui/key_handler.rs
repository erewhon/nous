use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};

use super::app_state::{Mode, TuiState};

pub fn handle_key(state: &mut TuiState, key: KeyEvent) {
    // Clear flash message on any keypress
    state.flash_message = None;

    match state.mode {
        Mode::Tree => handle_tree_key(state, key),
        Mode::Content => handle_content_key(state, key),
        Mode::Search => handle_search_key(state, key),
        Mode::CreateNote => handle_input_key(state, key, true),
        Mode::InboxCapture => handle_input_key(state, key, false),
    }
}

fn handle_tree_key(state: &mut TuiState, key: KeyEvent) {
    // Handle pending 'g' key
    if state.pending_key == Some('g') {
        state.pending_key = None;
        if key.code == KeyCode::Char('g') {
            state.tree_go_top();
            return;
        }
        // Not 'gg', ignore
    }

    match key.code {
        KeyCode::Char('q') => state.quit = true,
        KeyCode::Char('j') | KeyCode::Down => state.tree_move_down(),
        KeyCode::Char('k') | KeyCode::Up => state.tree_move_up(),
        KeyCode::Char('l') | KeyCode::Right | KeyCode::Enter => {
            state.open_selected_page();
        }
        KeyCode::Char('h') | KeyCode::Left => {
            state.collapse_or_parent();
        }
        KeyCode::Char('g') => {
            state.pending_key = Some('g');
        }
        KeyCode::Char('G') => state.tree_go_bottom(),
        KeyCode::Char('/') => {
            state.mode = Mode::Search;
            state.search_input.clear();
            state.search_results.clear();
        }
        KeyCode::Tab => {
            if !state.rendered_lines.is_empty() {
                state.mode = Mode::Content;
            }
        }
        KeyCode::Char('n') => {
            state.mode = Mode::CreateNote;
            state.input_text.clear();
        }
        KeyCode::Char('i') => {
            state.mode = Mode::InboxCapture;
            state.input_text.clear();
        }
        KeyCode::Char('?') => {
            state.show_help = !state.show_help;
        }
        _ => {}
    }
}

fn handle_input_key(state: &mut TuiState, key: KeyEvent, is_create_note: bool) {
    match key.code {
        KeyCode::Esc => {
            state.input_text.clear();
            state.mode = Mode::Tree;
        }
        KeyCode::Enter => {
            if is_create_note {
                state.create_note_from_input();
            } else {
                state.capture_inbox_from_input();
            }
        }
        KeyCode::Backspace => {
            state.input_text.pop();
        }
        KeyCode::Char(c) => {
            state.input_text.push(c);
        }
        _ => {}
    }
}

fn handle_content_key(state: &mut TuiState, key: KeyEvent) {
    // Handle pending 'g' key
    if state.pending_key == Some('g') {
        state.pending_key = None;
        if key.code == KeyCode::Char('g') {
            state.content_scroll = 0;
            return;
        }
    }

    match key.code {
        KeyCode::Char('q') => state.quit = true,
        KeyCode::Esc | KeyCode::Tab => {
            state.mode = Mode::Tree;
        }
        KeyCode::Char('j') | KeyCode::Down => state.content_scroll_down(1),
        KeyCode::Char('k') | KeyCode::Up => state.content_scroll_up(1),
        KeyCode::Char('d') => state.content_scroll_down(15),
        KeyCode::Char('u') => state.content_scroll_up(15),
        KeyCode::Char('g') => {
            state.pending_key = Some('g');
        }
        KeyCode::Char('G') => {
            state.content_scroll = state.rendered_lines.len().saturating_sub(1);
        }
        KeyCode::Char('/') => {
            state.mode = Mode::Search;
            state.search_input.clear();
            state.search_results.clear();
        }
        _ => {}
    }
}

fn handle_search_key(state: &mut TuiState, key: KeyEvent) {
    match key.code {
        KeyCode::Esc => {
            state.mode = Mode::Tree;
            state.search_input.clear();
            state.search_results.clear();
        }
        KeyCode::Enter => {
            state.navigate_to_search_result();
        }
        KeyCode::Backspace => {
            state.search_input.pop();
            state.perform_search();
        }
        KeyCode::Char(c) => {
            if key.modifiers.contains(KeyModifiers::CONTROL) {
                match c {
                    'n' => {
                        if !state.search_results.is_empty()
                            && state.search_selected < state.search_results.len() - 1
                        {
                            state.search_selected += 1;
                        }
                    }
                    'p' => {
                        if state.search_selected > 0 {
                            state.search_selected -= 1;
                        }
                    }
                    _ => {}
                }
            } else {
                state.search_input.push(c);
                state.perform_search();
            }
        }
        KeyCode::Down => {
            if !state.search_results.is_empty()
                && state.search_selected < state.search_results.len() - 1
            {
                state.search_selected += 1;
            }
        }
        KeyCode::Up => {
            if state.search_selected > 0 {
                state.search_selected -= 1;
            }
        }
        _ => {}
    }
}

pub fn handle_mouse(state: &mut TuiState, mouse: MouseEvent) {
    match mouse.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            let col = mouse.column;
            let row = mouse.row;

            // Check if click is in tree panel
            if let Some(ref area) = state.tree_area {
                if col >= area.x && col < area.x + area.width
                    && row >= area.y && row < area.y + area.height
                {
                    state.mode = Mode::Tree;

                    // Calculate which item was clicked (account for border)
                    let inner_row = row.saturating_sub(area.y + 1);
                    let clicked_idx = state.tree_scroll + inner_row as usize;

                    if clicked_idx < state.tree_items.len() {
                        if state.tree_selected == clicked_idx {
                            // Click same item again: open/toggle
                            state.open_selected_page();
                        } else {
                            state.tree_selected = clicked_idx;
                        }
                    }
                    return;
                }
            }

            // Check if click is in content panel
            if let Some(ref area) = state.content_area {
                if col >= area.x && col < area.x + area.width
                    && row >= area.y && row < area.y + area.height
                {
                    state.mode = Mode::Content;
                    return;
                }
            }
        }
        MouseEventKind::ScrollDown => match state.mode {
            Mode::Tree => state.tree_move_down(),
            Mode::Content => state.content_scroll_down(3),
            _ => {}
        },
        MouseEventKind::ScrollUp => match state.mode {
            Mode::Tree => state.tree_move_up(),
            Mode::Content => state.content_scroll_up(3),
            _ => {}
        },
        _ => {}
    }
}

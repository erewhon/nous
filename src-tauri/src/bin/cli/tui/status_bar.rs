use ratatui::prelude::*;
use ratatui::widgets::Paragraph;

use super::app_state::{Mode, TuiState};

pub fn draw(f: &mut Frame, area: Rect, state: &TuiState) {
    // Show flash message if present
    if let Some(ref msg) = state.flash_message {
        let flash = Paragraph::new(format!(" {}", msg))
            .style(Style::default().bg(Color::Green).fg(Color::Black));
        f.render_widget(flash, area);
        return;
    }

    match state.mode {
        Mode::CreateNote => {
            let text = format!(" New page: {}█", state.input_text);
            let prompt = Paragraph::new(text)
                .style(Style::default().bg(Color::Blue).fg(Color::White));
            f.render_widget(prompt, area);
        }
        Mode::InboxCapture => {
            let text = format!(" Inbox: {}█", state.input_text);
            let prompt = Paragraph::new(text)
                .style(Style::default().bg(Color::Magenta).fg(Color::White));
            f.render_widget(prompt, area);
        }
        _ => {
            let hints = match state.mode {
                Mode::Tree => {
                    " /: search  n: new page  i: inbox  j/k: navigate  Enter: open  q: quit "
                }
                Mode::Content => {
                    " Esc: back  /: search  j/k: scroll  d/u: half-page  gg/G: top/bottom  q: quit "
                }
                Mode::Search => {
                    " Type to search  Up/Down: select  Enter: open  Esc: cancel "
                }
                _ => unreachable!(),
            };

            let status = Paragraph::new(hints)
                .style(Style::default().bg(Color::DarkGray).fg(Color::White));
            f.render_widget(status, area);
        }
    }
}

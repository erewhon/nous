;;; nous.el --- Emacs client for Nous notebooks -*- lexical-binding: t; -*-

;; Copyright (C) 2026
;; SPDX-License-Identifier: AGPL-3.0-only

;; Author: erewhon
;; Version: 0.1.0
;; Package-Requires: ((emacs "28.1"))
;; Keywords: tools, notes
;; URL: https://github.com/erewhon/nous

;;; Commentary:

;; Browse, view, and edit Nous notebook pages from Emacs.
;; Pages are displayed as Markdown with YAML frontmatter.
;;
;; Usage:
;;   M-x nous           - Open the notebook browser
;;   M-x nous-search    - Search across all notebooks
;;
;; In the notebook list:
;;   RET   - Open notebook (list pages)
;;   g     - Refresh
;;   q     - Quit
;;
;; In the page list:
;;   RET   - Open page
;;   g     - Refresh
;;   n     - New page
;;   q     - Back to notebooks
;;
;; In a page buffer:
;;   C-c C-c - Save page
;;   C-c C-r - Revert (re-fetch from server)
;;   C-x C-s - Save page

;;; Code:

(require 'json)
(require 'url)
(require 'url-http)

;; ===== Customization =====

(defgroup nous nil
  "Emacs client for Nous notebooks."
  :group 'tools
  :prefix "nous-")

(defcustom nous-host "localhost"
  "Hostname of the Nous daemon."
  :type 'string)

(defcustom nous-port 7667
  "Port of the Nous daemon."
  :type 'integer)

(defcustom nous-api-key nil
  "API key for daemon authentication.
If nil, auto-discovered from ~/.local/share/nous/daemon-api-key."
  :type '(choice (const :tag "Auto-discover" nil) string))

(defvar nous--api-key-cache 'unset
  "Cached API key (nil = no key, string = key, `unset` = not loaded).")

(defun nous--get-api-key ()
  "Return the API key, auto-discovering from key file if needed."
  (or nous-api-key
      (progn
        (when (eq nous--api-key-cache 'unset)
          (setq nous--api-key-cache (nous--read-key-file)))
        nous--api-key-cache)))

(defun nous--read-key-file ()
  "Read the first rw: key from the daemon key file."
  (let ((path (expand-file-name "~/.local/share/nous/daemon-api-key")))
    (when (file-readable-p path)
      (with-temp-buffer
        (insert-file-contents path)
        (catch 'found
          (dolist (line (split-string (buffer-string) "\n"))
            (let ((trimmed (string-trim line)))
              (when (and (not (string-empty-p trimmed))
                         (not (string-prefix-p "#" trimmed))
                         (string-prefix-p "rw:" trimmed))
                (throw 'found trimmed))))
          nil)))))

(defun nous--auth-headers ()
  "Return auth headers as alist, or nil if no key."
  (let ((key (nous--get-api-key)))
    (when key
      (list (cons "Authorization" (concat "Bearer " key))))))

;; ===== HTTP layer =====

(defun nous--api-url (path)
  "Build full API URL for PATH."
  (format "http://%s:%d%s" nous-host nous-port path))

(defun nous--api-get-json (path)
  "GET PATH, return parsed JSON as alist."
  (let ((url-request-method "GET")
        (url-request-extra-headers (nous--auth-headers))
        (url-show-status nil))
    (with-current-buffer (url-retrieve-synchronously (nous--api-url path) t t 10)
      (goto-char (point-min))
      (re-search-forward "\n\n")
      (let ((result (json-parse-buffer :object-type 'alist :array-type 'list)))
        (kill-buffer)
        result))))

(defun nous--api-get-text (path)
  "GET PATH, return response body as string."
  (let ((url-request-method "GET")
        (url-request-extra-headers (nous--auth-headers))
        (url-show-status nil))
    (with-current-buffer (url-retrieve-synchronously (nous--api-url path) t t 10)
      (goto-char (point-min))
      (re-search-forward "\n\n")
      (let ((result (buffer-substring-no-properties (point) (point-max))))
        (kill-buffer)
        result))))

(defun nous--api-put-json (path data)
  "PUT DATA as JSON to PATH, return parsed JSON response."
  (let ((url-request-method "PUT")
        (url-request-extra-headers (append '(("Content-Type" . "application/json"))
                                           (nous--auth-headers)))
        (url-request-data (encode-coding-string (json-encode data) 'utf-8))
        (url-show-status nil))
    (with-current-buffer (url-retrieve-synchronously (nous--api-url path) t t 10)
      (goto-char (point-min))
      (re-search-forward "\n\n")
      (let ((result (json-parse-buffer :object-type 'alist :array-type 'list)))
        (kill-buffer)
        result))))

(defun nous--api-post-json (path data)
  "POST DATA as JSON to PATH, return parsed JSON response."
  (let ((url-request-method "POST")
        (url-request-extra-headers (append '(("Content-Type" . "application/json"))
                                           (nous--auth-headers)))
        (url-request-data (encode-coding-string (json-encode data) 'utf-8))
        (url-show-status nil))
    (with-current-buffer (url-retrieve-synchronously (nous--api-url path) t t 10)
      (goto-char (point-min))
      (re-search-forward "\n\n")
      (let ((result (json-parse-buffer :object-type 'alist :array-type 'list)))
        (kill-buffer)
        result))))

;; ===== Helpers =====

(defun nous--alist-get (key alist)
  "Get KEY from ALIST.  KEY may be a symbol or string; tries both forms."
  (let ((sym (if (symbolp key) key (intern key))))
    (alist-get sym alist)))

(defun nous--format-time (iso-str)
  "Format ISO-STR timestamp to a short date string."
  (if (and iso-str (not (equal iso-str :null)) (stringp iso-str))
      (condition-case nil
          (format-time-string "%Y-%m-%d %H:%M"
                              (date-to-time iso-str))
        (error ""))
    ""))

;; ===== Notebook Browser =====

(defvar nous--notebooks-cache nil
  "Cached list of notebooks.")

(defvar nous-notebooks-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "RET") #'nous-notebooks-open)
    (define-key map (kbd "g") #'nous-notebooks-refresh)
    (define-key map (kbd "q") #'quit-window)
    map)
  "Keymap for `nous-notebooks-mode'.")

(define-derived-mode nous-notebooks-mode tabulated-list-mode "Nous-Notebooks"
  "Major mode for browsing Nous notebooks."
  (setq tabulated-list-format [("Notebook" 40 t)
                                ("Type" 12 t)])
  (setq tabulated-list-padding 2)
  (tabulated-list-init-header))

(defun nous-notebooks-refresh ()
  "Refresh the notebook list."
  (interactive)
  (let* ((response (nous--api-get-json "/api/notebooks"))
         (notebooks (nous--alist-get 'data response))
         (entries nil))
    (setq nous--notebooks-cache notebooks)
    ;; Sort alphabetically by name
    (setq notebooks (sort (copy-sequence notebooks)
                          (lambda (a b)
                            (string< (downcase (or (nous--alist-get 'name a) ""))
                                     (downcase (or (nous--alist-get 'name b) ""))))))
    (dolist (nb notebooks)
      (let ((id (nous--alist-get 'id nb))
            (name (or (nous--alist-get 'name nb) "(untitled)"))
            (ntype (or (nous--alist-get 'type nb)
                       (nous--alist-get 'notebookType nb)
                       "")))
        (push (list id (vector name (format "%s" ntype))) entries)))
    (setq tabulated-list-entries (nreverse entries))
    (tabulated-list-print t)))

(defun nous-notebooks-open ()
  "Open the notebook at point."
  (interactive)
  (let ((id (tabulated-list-get-id)))
    (when id
      (let* ((nb (seq-find (lambda (n) (string= (nous--alist-get 'id n) id))
                           nous--notebooks-cache))
             (name (or (and nb (nous--alist-get 'name nb)) id)))
        (nous-pages id name)))))

;;;###autoload
(defun nous ()
  "Open the Nous notebook browser."
  (interactive)
  (let ((buf (get-buffer-create "*nous: notebooks*")))
    (with-current-buffer buf
      (nous-notebooks-mode)
      (nous-notebooks-refresh))
    (switch-to-buffer buf)))

;; ===== Page Browser =====

(defvar-local nous--pages-notebook-id nil
  "Notebook ID for the current page list buffer.")

(defvar-local nous--pages-notebook-name nil
  "Notebook name for the current page list buffer.")

(defvar-local nous--pages-cache nil
  "Cached page list for the current buffer.")

(defvar-local nous--folders-cache nil
  "Cached folder id-to-name mapping.")

(defvar nous-pages-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "RET") #'nous-pages-open)
    (define-key map (kbd "g") #'nous-pages-refresh)
    (define-key map (kbd "n") #'nous-pages-new)
    (define-key map (kbd "q") #'nous-pages-back)
    map)
  "Keymap for `nous-pages-mode'.")

(define-derived-mode nous-pages-mode tabulated-list-mode "Nous-Pages"
  "Major mode for browsing pages in a Nous notebook."
  (setq tabulated-list-format [("Title" 45 t)
                                ("Folder" 20 t)
                                ("Tags" 25 t)
                                ("Updated" 18 t)])
  (setq tabulated-list-padding 2)
  (tabulated-list-init-header))

(defun nous--fetch-folders (notebook-id)
  "Fetch folders for NOTEBOOK-ID, return id-to-name hash table."
  (let* ((response (nous--api-get-json (format "/api/notebooks/%s/folders" notebook-id)))
         (folders (nous--alist-get 'data response))
         (table (make-hash-table :test 'equal)))
    (dolist (f folders)
      (puthash (nous--alist-get 'id f)
               (or (nous--alist-get 'name f) "")
               table))
    table))

(defun nous-pages-refresh ()
  "Refresh the page list."
  (interactive)
  (let* ((nb-id nous--pages-notebook-id)
         (response (nous--api-get-json (format "/api/notebooks/%s/pages" nb-id)))
         (pages (nous--alist-get 'data response))
         (folders (nous--fetch-folders nb-id))
         (entries nil))
    (setq nous--pages-cache pages)
    (setq nous--folders-cache folders)
    ;; Filter out trashed pages and sort by updated_at descending
    (let ((active (seq-filter (lambda (p)
                                (let ((del (nous--alist-get 'deletedAt p)))
                                  (or (null del) (equal del :null)
                                      (and (stringp del) (string-empty-p del)))))
                              pages)))
      (setq active (sort active
                         (lambda (a b)
                           (string> (or (nous--alist-get 'updatedAt a) "")
                                    (or (nous--alist-get 'updatedAt b) "")))))
      (dolist (pg active)
        (let* ((id (nous--alist-get 'id pg))
               (title (or (nous--alist-get 'title pg) "(untitled)"))
               (folder-id (nous--alist-get 'folderId pg))
               (folder-name (if (and folder-id (not (equal folder-id :null)))
                                (or (gethash folder-id folders) "")
                              ""))
               (tags (nous--alist-get 'tags pg))
               (tags-str (if (and tags (listp tags))
                             (string-join tags ", ")
                           ""))
               (updated (nous--format-time (nous--alist-get 'updatedAt pg))))
          (push (list id (vector title folder-name tags-str updated)) entries)))
      (setq tabulated-list-entries (nreverse entries))
      (tabulated-list-print t))))

(defun nous-pages-open ()
  "Open the page at point."
  (interactive)
  (let ((id (tabulated-list-get-id)))
    (when id
      (nous-open-page nous--pages-notebook-id id))))

(defun nous-pages-new ()
  "Create a new page in the current notebook."
  (interactive)
  (let* ((title (read-string "Page title: "))
         (response (nous--api-post-json
                    (format "/api/notebooks/%s/pages" nous--pages-notebook-id)
                    `((title . ,title)))))
    (let* ((page (nous--alist-get 'data response))
           (page-id (nous--alist-get 'id page)))
      (nous-pages-refresh)
      (when page-id
        (nous-open-page nous--pages-notebook-id page-id)))))

(defun nous-pages-back ()
  "Go back to the notebook list."
  (interactive)
  (quit-window)
  (nous))

(defun nous-pages (notebook-id notebook-name)
  "Open the page list for NOTEBOOK-ID with NOTEBOOK-NAME."
  (let ((buf (get-buffer-create (format "*nous: %s*" notebook-name))))
    (with-current-buffer buf
      (nous-pages-mode)
      (setq nous--pages-notebook-id notebook-id)
      (setq nous--pages-notebook-name notebook-name)
      (nous-pages-refresh))
    (switch-to-buffer buf)))

;; ===== Page View/Edit =====

(defvar-local nous--page-notebook-id nil
  "Notebook ID for the current page buffer.")

(defvar-local nous--page-id nil
  "Page ID for the current page buffer.")

(defvar-local nous--page-title nil
  "Original title of the current page.")

(defvar nous-page-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "C-c C-c") #'nous-save-page)
    (define-key map (kbd "C-c C-r") #'nous-revert-page)
    (define-key map (kbd "C-x C-s") #'nous-save-page)
    map)
  "Keymap for `nous-page-mode'.")

(define-minor-mode nous-page-mode
  "Minor mode for Nous page buffers.

\\{nous-page-mode-map}"
  :lighter " Nous"
  :keymap nous-page-mode-map
  (when nous-page-mode
    (add-hook 'after-change-functions #'nous--mark-modified nil t)))

(defun nous--mark-modified (&rest _)
  "Mark buffer as modified after any edit."
  nil) ; buffer-modified flag is set automatically

(defun nous--parse-frontmatter ()
  "Parse YAML frontmatter from current buffer.
Return plist (:title TITLE :tags (TAG ...) :body-start LINE)."
  (save-excursion
    (goto-char (point-min))
    (if (not (looking-at "^---[ \t]*$"))
        (list :title nil :tags nil :body-start 1)
      (forward-line 1)
      (let ((fm-start (point))
            (title nil)
            (tags nil))
        (if (not (re-search-forward "^---[ \t]*$" nil t))
            (list :title nil :tags nil :body-start 1)
          (let ((fm-end (match-beginning 0))
                (body-start (1+ (line-number-at-pos (match-end 0)))))
            ;; Extract title
            (goto-char fm-start)
            (when (re-search-forward "^title:[ \t]*\"?\\([^\"]*?\\)\"?[ \t]*$" fm-end t)
              (setq title (match-string 1)))
            ;; Extract tags
            (goto-char fm-start)
            (when (re-search-forward "^tags:[ \t]*$" fm-end t)
              (while (and (= (forward-line 1) 0)
                          (< (point) fm-end)
                          (looking-at "^  - \"?\\([^\"]*?\\)\"?[ \t]*$"))
                (push (match-string 1) tags))
              (setq tags (nreverse tags)))
            (list :title title :tags tags :body-start body-start)))))))

(defun nous--extract-body ()
  "Return the markdown body after frontmatter."
  (save-excursion
    (goto-char (point-min))
    (if (looking-at "^---[ \t]*$")
        (progn
          (forward-line 1)
          (if (re-search-forward "^---[ \t]*$" nil t)
              (progn
                (forward-line 1)
                ;; Skip blank line after frontmatter
                (when (looking-at "^[ \t]*$")
                  (forward-line 1))
                (buffer-substring-no-properties (point) (point-max)))
            (buffer-substring-no-properties (point-min) (point-max))))
      (buffer-substring-no-properties (point-min) (point-max)))))

(defun nous-open-page (notebook-id page-id)
  "Fetch and display page PAGE-ID from NOTEBOOK-ID as markdown."
  (let* ((path (format "/api/notebooks/%s/pages/%s?format=markdown" notebook-id page-id))
         (markdown (nous--api-get-text path))
         (buf-name (format "*nous: %s*"
                           (or (nous--extract-title-from-md markdown) page-id))))
    (let ((buf (get-buffer-create buf-name)))
      (with-current-buffer buf
        (let ((inhibit-read-only t))
          (erase-buffer)
          (insert markdown)
          (goto-char (point-min)))
        ;; Set up mode
        (when (fboundp 'markdown-mode)
          (markdown-mode))
        (nous-page-mode 1)
        (setq-local nous--page-notebook-id notebook-id)
        (setq-local nous--page-id page-id)
        ;; Parse title from frontmatter
        (let ((fm (nous--parse-frontmatter)))
          (setq-local nous--page-title (plist-get fm :title)))
        (set-buffer-modified-p nil))
      (switch-to-buffer buf))))

(defun nous--extract-title-from-md (markdown)
  "Extract title from YAML frontmatter in MARKDOWN string."
  (when (string-match "^---\n.*?title:[ \t]*\"?\\([^\"]*?\\)\"?[ \t]*\n" markdown)
    (match-string 1 markdown)))

(defun nous-save-page ()
  "Save the current page buffer back to Nous."
  (interactive)
  (unless nous--page-id
    (user-error "Not a Nous page buffer"))
  (let* ((fm (nous--parse-frontmatter))
         (title (plist-get fm :title))
         (tags (plist-get fm :tags))
         (body (nous--extract-body))
         (path (format "/api/notebooks/%s/pages/%s"
                       nous--page-notebook-id nous--page-id))
         (data `((markdown . ,body))))
    ;; Include title if changed
    (when title
      (push (cons 'title title) data))
    ;; Include tags if present in frontmatter
    (when tags
      (push (cons 'tags (vconcat tags)) data))
    (nous--api-put-json path data)
    (set-buffer-modified-p nil)
    (message "Saved to Nous.")))

(defun nous-revert-page ()
  "Re-fetch the current page from the server."
  (interactive)
  (unless nous--page-id
    (user-error "Not a Nous page buffer"))
  (when (or (not (buffer-modified-p))
            (yes-or-no-p "Buffer modified. Discard changes? "))
    (let* ((path (format "/api/notebooks/%s/pages/%s?format=markdown"
                         nous--page-notebook-id nous--page-id))
           (markdown (nous--api-get-text path)))
      (let ((inhibit-read-only t)
            (pos (point)))
        (erase-buffer)
        (insert markdown)
        (goto-char (min pos (point-max))))
      (set-buffer-modified-p nil)
      (message "Reverted."))))

;; ===== Search =====

;;;###autoload
(defun nous-search (query)
  "Search all notebooks for QUERY."
  (interactive "sSearch Nous: ")
  (let* ((response (nous--api-get-json
                    (format "/api/search?q=%s" (url-hexify-string query))))
         (results (nous--alist-get 'data response))
         (buf (get-buffer-create "*nous: search*")))
    (with-current-buffer buf
      (let ((inhibit-read-only t))
        (erase-buffer)
        (insert (format "Search results for: %s\n\n" query))
        (if (or (null results) (equal results :null) (= (length results) 0))
            (insert "No results found.\n")
          (dolist (r results)
            (let ((title (or (nous--alist-get 'title r) "(untitled)"))
                  (page-id (nous--alist-get 'id r))
                  (notebook-id (nous--alist-get 'notebookId r))
                  (snippet (or (nous--alist-get 'snippet r) "")))
              (insert-text-button title
                                  'action (lambda (_btn)
                                            (nous-open-page
                                             (button-get _btn 'notebook-id)
                                             (button-get _btn 'page-id)))
                                  'notebook-id notebook-id
                                  'page-id page-id
                                  'face 'link)
              (insert "\n")
              (when (not (string-empty-p snippet))
                (insert "  " snippet "\n"))
              (insert "\n")))))
      (goto-char (point-min))
      (special-mode))
    (switch-to-buffer buf)))

;; ===== Evil compatibility =====

(defun nous--setup-evil ()
  "Register Evil keybindings for Nous modes."
  (when (bound-and-true-p evil-mode)
    ;; Notebook browser: use motion state
    (evil-set-initial-state 'nous-notebooks-mode 'motion)
    (evil-define-key 'motion nous-notebooks-mode-map
      (kbd "RET") #'nous-notebooks-open
      "g" nil ; free up g prefix
      "gr" #'nous-notebooks-refresh
      "q" #'quit-window)
    ;; Page browser: use motion state
    (evil-set-initial-state 'nous-pages-mode 'motion)
    (evil-define-key 'motion nous-pages-mode-map
      (kbd "RET") #'nous-pages-open
      "g" nil
      "gr" #'nous-pages-refresh
      "n" #'nous-pages-new
      "q" #'nous-pages-back)))

(with-eval-after-load 'evil
  (nous--setup-evil))

;; If evil is already loaded, set up now
(when (bound-and-true-p evil-mode)
  (nous--setup-evil))

(provide 'nous)
;;; nous.el ends here

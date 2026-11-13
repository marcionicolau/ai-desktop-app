# Feature Specification: Scripts Workspace & External Script Files

**Feature Branch**: `027-scripts-workspace-external-files`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Give scripts their own workspace space in the sidebar (like Chats and Extensions), grouped by language (Python and R) with counts and a missing-runtime indicator; selecting a script opens it directly instead of a list page. Add the ability to load scripts from external files via a native file picker (single or multiple .py/.R files), choosing per import to Link (default) or Copy. A linked file that goes missing shows a 'source missing' state with a Relink action. A linked file can change after the user approved it, so show an 'external' badge and require re-consent when its content changes. Keep the typed absolute-path field under Advanced. Runtime path settings stay in Settings with a link from the Scripts group."

## Clarifications

### Session 2026-11-13

- Q: Should re-approval of a changed linked script apply even when the user chose to allow all script runs for the session? → A: Yes. The app always re-asks when the content changed, and the prompt offers "Approve changes to this script for this session" so the user can stop being asked while iterating on purpose.

### Session 2026-04-01

- Q: For a linked script, can the user edit its code inside the app, or is the code view read-only? → A: Read-only. In-place editing applies to id, params, enabled, timeout and the Advanced path field; code changes happen by editing the file on disk or by importing the file as a Copy.
- Q: When is a linked script's content counted as "approved" for the content-changed check? → A: The file's content at the moment it is linked (picker import, Relink, or typed path) is the approved baseline; a re-prompt happens only when the content changes after that.
- Q: What size limit applies to imported script files? → A: 2 MiB per file — the same bound applied to file attachments; larger files are rejected per file with a "too large" reason.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scripts have their own space, grouped by language (Priority: P1)

As a user who keeps several Python and R scripts, I find them in a dedicated Scripts area of the sidebar — alongside Chats and Extensions, not buried under Configurations. Scripts are grouped under Python and R with a count per group. I click a script and it opens directly, showing how to run it, its code and its parameters.

**Why this priority**: Scripts are a first-class working surface, not a setting. Today they live behind a settings-style list page, which adds a click and hides what exists. This is the foundation the import and safety stories build on.

**Independent Test**: With two Python scripts and one R script registered, open the app → the Scripts area lists a Python group (2) and an R group (1); click one script → its run form, code and parameters appear with no intermediate list page.

**Acceptance Scenarios**:

1. **Given** registered scripts, **When** the sidebar is shown, **Then** a Scripts area appears at the same level as Chats and Extensions, and Scripts no longer appears under Configurations.
2. **Given** scripts in both languages, **When** the Scripts area is shown, **Then** each language group lists its scripts alphabetically with a count, and each group can be collapsed.
3. **Given** a language whose runtime is not installed or not found, **When** its group is shown, **Then** the group and each of its scripts carry a visible "runtime missing" indicator that says why, and the scripts remain viewable and editable.
4. **Given** the user selects a script, **When** it opens, **Then** the run form, the code and the parameters are shown directly, and a way to edit it is available in place.
5. **Given** no scripts exist, **When** the Scripts area is shown, **Then** it explains that there are none and offers New script and Import from file.
6. **Given** a disabled script, **When** it is listed, **Then** it is visibly distinct from enabled ones but still selectable.
7. **Given** the Scripts area, **When** the user wants to change interpreter paths, **Then** a link takes them to the runtime settings, which stay in Settings.

---

### User Story 2 - Import scripts from files on disk (Priority: P1)

As a user with scripts that already exist as files, I pick one or several of them with a native file picker instead of pasting code or typing paths. The app works out the language from each file's extension and suggests an id from its name. I choose whether the app links to the file where it is (default) or stores a copy.

**Why this priority**: This is the other explicit request, and the most common real-world starting point — scripts already live in files and editors.

**Independent Test**: Choose Import from file, select three files (two `.py`, one `.R`), accept the default → three scripts appear in the right language groups, each runnable, with no code pasted.

**Acceptance Scenarios**:

1. **Given** the Import action, **When** the user picks files, **Then** multiple files can be selected at once, and only Python (`.py`) and R (`.r`/`.R`, any letter case) files are accepted.
2. **Given** picked files, **When** the import is confirmed, **Then** each script gets its language from the extension and a suggested id from the file name, which the user can change before confirming; a clashing id is made unique automatically.
3. **Given** the import choice, **When** the user confirms with the default, **Then** the scripts are linked: the file stays where it is, and the next run uses its current content, so edits on disk are picked up without re-importing.
4. **Given** the user chooses Copy, **When** the import completes, **Then** the content is stored in the library and later changes to the original file do not affect the script.
5. **Given** a batch where some files cannot be imported (unreadable, not text, too large, unsupported type), **When** the import runs, **Then** the valid files are still imported and each failure is reported with its file name and reason.
6. **Given** a file that is already linked as a script, **When** it is picked again, **Then** the user is told which script it already is and no duplicate is created.
7. **Given** the script editor, **When** the user wants to enter a path by typing, **Then** the absolute-path field is still available, under an Advanced section.

---

### User Story 3 - Linked files stay safe and recoverable (Priority: P2)

As a user who linked a script, I can tell it is external, I am protected if it changes after I approved it, and I can recover if the file moves or disappears.

**Why this priority**: A linked file can be edited by anything with disk access after the user approved running it. Without protection, approval would not mean what the user thinks. Without recovery, a moved file would turn into a confusing failure.

**Independent Test**: Approve a model-invoked run of a linked script, edit the file on disk, trigger the run again → the app asks again and says the content changed. Move the file → the script shows "source missing" with Relink, and no run fails with an error.

**Acceptance Scenarios**:

1. **Given** a linked script, **When** it is listed or opened, **Then** an "external" badge and the file location are shown.
2. **Given** a linked script the user previously approved, **When** its content has changed since that approval and a model or pipeline invokes it (even under a session-wide allow), **Then** the app asks for approval again, states that the content changed, and records the new content as approved only if the user agrees; the prompt offers "Approve changes to this script for this session".
3. **Given** a linked script whose file is missing or unreadable, **When** it is listed, opened or invoked, **Then** it shows a "source missing" state with a Relink action, a run is not attempted, and a model invocation receives a clear "source missing" refusal instead of an error.
4. **Given** Relink, **When** the user picks a replacement file, **Then** the script keeps its id and settings and uses the new file; the content-changed check applies to the new content.
5. **Given** a manual run (the user clicked Run), **When** the content has changed, **Then** it runs without an extra prompt, as manual runs do today.
6. **Given** a run already in progress, **When** the file is edited, **Then** the run uses the content read when it started.

---

### Edge Cases

- Existing scripts registered before this feature keep working: stored ones are grouped by language; those registered with an external path appear as linked (with the badge).
- A file with an upper-case extension (`.PY`, `.R`) is accepted; any other extension is rejected with a clear reason.
- A very long group (hundreds of scripts) stays scrollable and the sidebar layout does not break.
- A runtime that is missing for one language does not affect the other language's group.
- Two scripts that would get the same id (same file name from different folders) both import, the second with a distinct id.
- A linked file replaced by a directory, a binary file, or an unreadable file is reported as "source missing/unreadable" with Relink.
- Selecting a script while another is running does not interrupt the running one.
- Renaming a script's id does not break its link.
- The sidebar's collapsed (icon-only) state still gives access to the Scripts area.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The sidebar MUST provide a Scripts area at the same level as Chats and Extensions, and Scripts MUST no longer appear under Configurations.
- **FR-002**: The Scripts area MUST group scripts by language (Python, R), list each group's scripts alphabetically with a count, and let each group be collapsed; groups with no scripts are not shown.
- **FR-003**: A language group and each of its scripts MUST show a visible indicator, with the reason, when that language's runtime is not available; those scripts MUST remain viewable and editable.
- **FR-004**: Selecting a script MUST open it directly with its run form, code and parameters; the intermediate list page MUST be removed, and editing MUST be available in place.
- **FR-005**: The Scripts area MUST offer New script and Import from file, and a link to the runtime settings; runtime path settings MUST stay in Settings.
- **FR-006**: Disabled scripts MUST be visibly distinct from enabled ones and remain selectable.
- **FR-007**: The Scripts area MUST be reachable when the sidebar is collapsed, from the command palette (each script can be opened by name), and the header MUST show the location as Scripts › language › script name.
- **FR-008**: Import MUST use a native file picker that allows selecting several files and accepts only Python (`.py`) and R (`.r`/`.R`, any letter case) files.
- **FR-009**: Import MUST infer each script's language from its extension and suggest an id from the file name; the user MUST be able to edit the id before confirming, and clashing ids MUST be made unique automatically.
- **FR-010**: Import MUST let the user choose Link or Copy for the batch; Link MUST be the default.
- **FR-011**: A linked script MUST be read from its file at each run and whenever it is opened, so edits on disk are picked up without re-importing.
- **FR-012**: A copied script MUST be stored in the library and MUST NOT change when the original file changes.
- **FR-013**: Import MUST validate each file (readable, text, at most 2 MiB), import the valid ones even when others fail, and report each failure with the file name and reason.
- **FR-014**: Importing a file that is already linked MUST NOT create a duplicate and MUST tell the user which script it already is.
- **FR-015**: Linked scripts MUST show an "external" badge and the file location wherever the script is listed or opened.
- **FR-016**: When a linked script's file is missing or unreadable, the script MUST show a "source missing" state with a Relink action, a run MUST NOT be attempted, and a model- or pipeline-initiated invocation MUST receive a clear refusal stating the source is missing.
- **FR-017**: Relinking MUST keep the script's id and settings and switch it to the newly chosen file.
- **FR-018**: When a linked script's content differs from the content the user last approved, the next model- or pipeline-initiated run MUST ask for approval again, say that the content changed, and record the new content as approved only on consent. The file's content at the moment it is linked (picker import, Relink, or typed path) is the approved baseline. This applies even when the user has chosen to allow all script runs for the session. The prompt MUST offer "Approve changes to this script for this session", which suppresses further prompts for that script until the session ends.
- **FR-019**: A manual run (the user clicked Run) MUST NOT require the extra approval, matching existing behavior; a run already in progress MUST use the content read when it started.
- **FR-020**: The editor MUST keep the typed absolute-path field, under an Advanced section.
- **FR-021**: Existing scripts MUST keep working after the change: stored scripts are grouped by language and scripts registered with an external path appear as linked.
- **FR-022**: Execution isolation, timeouts, argument validation and the audit trail MUST be unchanged; the audit record MUST additionally say whether the script was linked or stored.
- **FR-023**: For a linked script, the in-app code view MUST be read-only and MUST reflect the file's current content; "editing in place" (FR-004) applies to id, params, enabled, timeout and the Advanced path field. Code changes happen by editing the file on disk or by importing the file as a Copy.

### Key Entities

- **Script**: id, language (Python or R), origin (stored or linked), location (for linked scripts), enabled state, and the content version the user last approved.
- **Script group**: the set of scripts of one language, with a count and a runtime-availability state.
- **Import batch**: the files chosen in one import, the Link/Copy choice, and the per-file result (imported, skipped as duplicate, or failed with a reason).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can open any registered script and be looking at its run form in at most 2 clicks from the main window, with no list page in between.
- **SC-002**: A user can import a single script from a file and run it in under 30 seconds, without typing or pasting anything.
- **SC-003**: A user can import a batch of 10 files in a single picker interaction, and every valid file becomes a runnable script.
- **SC-004**: 100% of model- or pipeline-initiated runs of a linked script whose content changed since approval ask for approval again, including under a session-wide allow, unless the user chose "Approve changes to this script for this session" (verified by editing the file between runs).
- **SC-005**: A linked script whose file is missing never produces an unexplained failure: in 100% of cases the user sees "source missing" with a Relink action within one view of the script.
- **SC-006**: After upgrading, 100% of previously registered scripts are still present, in the correct language group, and runnable, with zero data loss.
- **SC-007**: The Scripts area stays usable with 200 scripts: groups scroll, nothing overlaps, and opening a script takes no longer than with 5.
- **SC-008**: All existing quality gates pass and no existing script behavior regresses.

## Assumptions

- This builds on feature 023 (script registry, consent, audit) and on feature 026 (sidebar shell, command palette, breadcrumb, shared feedback patterns); it changes where scripts live and how they are loaded, not how they execute.
- Only Python and R are supported; no other languages are added.
- "Edits on disk are picked up" means the file is read when the script is opened or run; the app does not watch files continuously.
- Linked files are identified by absolute path; a moved or renamed file is recovered with Relink, not tracked automatically.
- The size limit for imported files is 2 MiB per file (the bound already applied to file attachments); the text-encoding limit is UTF-8 text — the same checks applied to stored scripts at save time.
- Re-approval applies to model- and pipeline-initiated runs, which already require approval; user-initiated manual runs are unchanged.
- The Linux file dialog goes through the existing external-dialog mechanism used for other pickers; macOS and Windows behavior follows the existing dialog contract.
- Collapse state of language groups is remembered per window; it is a convenience and not required to survive a reinstall.

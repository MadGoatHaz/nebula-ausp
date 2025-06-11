# Project Nebula: AI Collaboration Workflow & Rules of Engagement

This document defines the mandatory workflow for any AI collaborator on this project. Its purpose is to ensure stability, clarity, and efficiency. These rules are not guidelines; they are inviolable.

## 1. The Prime Directive: Stability First

- No change, feature, or fix will be delivered if it breaks the core functionality of the last stable version.
- A partially working feature is a complete failure.
- The application must always be in a runnable state at the end of a handoff. The AI must verify this before delivering code.

## 2. The Handoff Protocol

- **The Director (Human):** Issues high-level directives, feature requests, bug reports, and provides final approval on all work. Provides logs and screenshots as necessary.
- **The Implementer (AI):** Executes on the Director's directives. The AI will use search to inform its implementation strategy.
- **The Deliverable:** The AI's primary deliverable will always be a single, complete handoff document. This document will contain:
    1.  A summary of the work completed and the reasoning behind the implementation.
    2.  The full, complete contents of any new or modified files.
    3.  Explicit CLI commands for any necessary setup or execution steps.

## 3. The "Full File" Mandate

- The AI is **never** to provide partial code, diffs, or instructions like "add this line" or "modify this function."
- When a file is changed, the AI must provide the **entire, complete content** of that file in a single code block. This minimizes the risk of human error during implementation.

## 4. The Development Environment

- **Build Tool:** The project is built using **Vite.js**.
- **Language:** All frontend code is written in modular JavaScript (`.js` files).
- **Package Manager:** All dependencies are managed using **npm**.
- **Server:** The local development server is provided by Vite (`npm run dev`). The production server for deployment will be handled by GitHub Pages.

## 5. Versioning

- Each successful handoff from the AI constitutes a new version number (e.g., v97, v98).
- The project `README.md` will be updated as needed to reflect the current version and its features.
document.addEventListener("DOMContentLoaded", () => {
  // --- Configuration ---
  const AUTOSAVE_INTERVAL = 3000; // milliseconds (3 seconds)
  const AUTOSAVE_KEY = "advancedNotepad_autosave_v2";
  const THEME_KEY = "advancedNotepad_theme";

  // --- DOM Elements ---
  const editorContainer = document.getElementById("editor");
  const btnHamburger = document.getElementById("btnHamburger");
  const fileDropdown = document.getElementById("fileDropdown");
  const btnNew = document.getElementById("btnNew");
  const btnOpen = document.getElementById("btnOpen");
  const btnSave = document.getElementById("btnSave");
  const btnSaveAs = document.getElementById("btnSaveAs");
  const btnTheme = document.getElementById("btnTheme");
  const fileStatusEl = document.getElementById("fileStatus");
  const wordCountEl = document.getElementById("wordCount");
  const saveStatusEl = document.getElementById("saveStatus");
  const body = document.body;

  // --- State Variables ---
  let currentFileHandle = null;
  let currentFileName = "Untitled";
  let isDirty = false; // Track unsaved changes
  let autosaveTimer = null;
  let quill; // Quill instance

  // --- Quill Initialization ---

  // Whitelist fonts and register with Quill
  const Font = Quill.import("formats/font");
  Font.whitelist = [
    "sans-serif",
    "serif",
    "monospace", // Generic defaults
    "arial",
    "comic-sans",
    "courier-new",
    "georgia",
    "helvetica",
    "lucida",
    "tahoma",
    "times-new-roman",
    "trebuchet",
    "verdana",
  ];
  Quill.register(Font, true);

  // Whitelist sizes and register with Quill
  const Size = Quill.import("attributors/style/size");
  Size.whitelist = [
    "small",
    "normal",
    "large",
    "huge", // Relative sizes
    "10px",
    "12px",
    "18px",
    "24px",
    "32px", // Pixel sizes
  ];
  Quill.register(Size, true);

  function initializeQuill() {
    quill = new Quill(editorContainer, {
      modules: {
        toolbar: {
          container: "#quill-toolbar",
          handlers: {},
        },
        history: { delay: 1000, maxStack: 100, userOnly: true },
      },
      theme: "snow",
      // placeholder: "Start crafting your document...",
      formats: [
        "header",
        "font",
        "size",
        "bold",
        "italic",
        "underline",
        "strike",
        "blockquote",
        "code-block",
        "list",
        "bullet",
        "ordered",
        "indent",
        "link",
        "image",
        "video",
        "color",
        "background",
        "align",
        "script",
        "clean",
      ],
    });

    quill.on("text-change", handleTextChange);
    quill.on("selection-change", handleSelectionChange);
  }

  // --- Event Handlers ---
  function handleTextChange(delta, oldDelta, source) {
    if (source === "user") {
      isDirty = true;
      updateStatusBar();
      scheduleAutosave();
      updateSaveStatus("Unsaved changes");
      if (fileDropdown.classList.contains("show")) {
        fileDropdown.classList.remove("show");
      }
    }
  }

  function handleSelectionChange(range, oldRange, source) {
    // Placeholder for potential future use (e.g., showing format in status bar)
  }

  // Hamburger Menu Logic
  btnHamburger.addEventListener("click", (event) => {
    event.stopPropagation();
    fileDropdown.classList.toggle("show");
  });

  // Close dropdown if clicked outside
  window.addEventListener("click", (event) => {
    if (!fileDropdown.contains(event.target) && event.target !== btnHamburger) {
      if (fileDropdown.classList.contains("show")) {
        fileDropdown.classList.remove("show");
      }
    }
    if (
      fileDropdown.contains(event.target) &&
      event.target.tagName === "BUTTON"
    ) {
      fileDropdown.classList.remove("show");
    }
  });

  // File Operation Button Listeners
  btnNew.addEventListener("click", newFile);
  btnOpen.addEventListener("click", openFile);
  btnSave.addEventListener("click", saveFile);
  btnSaveAs.addEventListener("click", saveFileAs);
  btnTheme.addEventListener("click", toggleTheme);

  // Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          newFile();
          break;
        case "o":
          e.preventDefault();
          openFile();
          break;
        case "s":
          e.preventDefault();
          saveFile();
          break;
        // Quill handles B, I, U. Browser/OS handles Z, Y.
      }
    }
  });

  // Warn before leaving page
  window.addEventListener("beforeunload", (e) => {
    if (isDirty) {
      const confirmationMessage =
        "You have unsaved changes. Are you sure you want to leave?";
      e.returnValue = confirmationMessage;
      return confirmationMessage;
    }
  });

  // --- Core Functions ---

  async function newFile() {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Start a new file anyway?")) {
        return;
      }
    }
    resetEditorState();
    quill.setContents([]);
    localStorage.removeItem(AUTOSAVE_KEY);
    updateStatusBar();
    updateSaveStatus("New file created");
  }

  async function openFile() {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Open a new file anyway?")) {
        return;
      }
    }

    if (!checkFileSystemApiSupport()) return;

    try {
      const pickerOpts = {
        types: [
          {
            description: "Supported Documents",
            accept: {
              "text/plain": [".txt", ".md", ".log"], // Prioritize text
              "application/json": [".json"],
              "text/html": [".html", ".htm"],
            },
          },
        ],
        excludeAcceptAllOption: false,
        multiple: false,
      };
      [currentFileHandle] = await window.showOpenFilePicker(pickerOpts);

      const file = await currentFileHandle.getFile();
      const contents = await file.text();
      currentFileName = file.name;

      // Determine content type and load accordingly
      if (
        file.type === "application/json" ||
        currentFileName.toLowerCase().endsWith(".json")
      ) {
        try {
          const delta = JSON.parse(contents);
          if (delta && Array.isArray(delta.ops)) {
            quill.setContents(delta);
          } else {
            throw new Error("Invalid Quill Delta format.");
          }
        } catch (err) {
          console.error(
            "Error parsing JSON/Delta, loading as plain text:",
            err
          );
          quill.setText(contents);
          updateSaveStatus("Error loading format, opened as text", true);
        }
      } else if (
        file.type === "text/html" ||
        currentFileName.toLowerCase().endsWith(".html") ||
        currentFileName.toLowerCase().endsWith(".htm")
      ) {
        try {
          const delta = quill.clipboard.convert(contents);
          quill.setContents(delta);
        } catch (err) {
          console.error("Error importing HTML, loading as plain text:", err);
          quill.setText(contents);
          updateSaveStatus("Error importing HTML, opened as text", true);
        }
      } else {
        // Default to plain text for .txt and others
        quill.setText(contents);
      }

      resetEditorState(file.name, currentFileHandle);
      updateSaveStatus(`Opened: ${currentFileName}`);
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Error opening file:", err);
        alert("Error opening file: " + err.message);
        updateSaveStatus("Error opening file", true);
      } else {
        updateSaveStatus("File open cancelled");
      }
    }
  }

  async function saveFile() {
    if (!currentFileHandle) {
      saveFileAs(); // No handle? Treat as Save As.
      return;
    }

    if (!(await checkWritePermission(currentFileHandle))) {
      updateSaveStatus("Permission denied to save", true);
      // Consider prompting for Save As here if permission denied
      return;
    }

    try {
      const writable = await currentFileHandle.createWritable();
      // *** Use currentFileName to determine format for existing file ***
      const contentToSave = getContentToSave(currentFileName);
      await writable.write(contentToSave);
      await writable.close();
      isDirty = false;
      updateSaveStatus(`Saved: ${currentFileName}`);
      localStorage.removeItem(AUTOSAVE_KEY);
      updateStatusBar();
    } catch (err) {
      console.error("Error saving file:", err);
      alert("Error saving file: " + err.message);
      updateSaveStatus("Error saving file", true);
    }
  }

  async function saveFileAs() {
    if (!checkFileSystemApiSupport(true)) return;

    try {
      // *** Suggest .txt as default ***
      let suggestedName = "Untitled.txt";
      if (currentFileName !== "Untitled") {
        // Keep current name, but ensure extension is handled by types
        const dotIndex = currentFileName.lastIndexOf(".");
        if (dotIndex > 0) {
          suggestedName = currentFileName.substring(0, dotIndex) + ".txt"; // Suggest changing extension to .txt
        } else {
          suggestedName = currentFileName + ".txt";
        }
        // If original was json/html, still suggest .txt first but user can change
      }

      const options = {
        // *** Put Plain Text first in the list ***
        types: [
          {
            description: "Plain Text (*.txt)",
            accept: { "text/plain": [".txt", ".md", ".log"] },
          },
          {
            description: "Quill Document (*.json)",
            accept: { "application/json": [".json"] },
          },
          {
            description: "HTML Document (*.html)",
            accept: { "text/html": [".html", ".htm"] },
          },
        ],
        suggestedName: suggestedName,
      };

      const newFileHandle = await window.showSaveFilePicker(options);

      // User confirmed save, now write the file
      const writable = await newFileHandle.createWritable();
      // *** Determine format based on the user's CHOSEN name (newFileHandle.name) ***
      const contentToSave = getContentToSave(newFileHandle.name);
      await writable.write(contentToSave);
      await writable.close();

      // Update state to reflect the newly saved file
      currentFileHandle = newFileHandle;
      currentFileName = newFileHandle.name;
      isDirty = false;
      updateSaveStatus(`Saved as: ${currentFileName}`);
      localStorage.removeItem(AUTOSAVE_KEY);
      updateStatusBar();
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Error saving file as:", err);
        alert("Error saving file: " + err.message);
        updateSaveStatus("Error saving file", true);
      } else {
        updateSaveStatus("File save cancelled");
      }
    }
  }

  // *** MODIFIED: Prioritize Plain Text output ***
  function getContentToSave(fileName) {
    const lowerCaseFileName = fileName.toLowerCase();
    // Determine format based on filename extension
    if (lowerCaseFileName.endsWith(".json")) {
      // Save Quill's Delta format (JSON) ONLY if explicitly .json
      return JSON.stringify(quill.getContents(), null, 2);
    } else if (
      lowerCaseFileName.endsWith(".html") ||
      lowerCaseFileName.endsWith(".htm")
    ) {
      // Save raw HTML ONLY if explicitly .html/.htm
      return quill.root.innerHTML;
    } else {
      // *** DEFAULT to plain text for .txt, .md, .log, or any other extension ***
      return quill.getText();
    }
  }

  function updateStatusBar() {
    const text = quill.getText().trim();
    const wordCount = text ? text.split(/[\s\n]+/).filter(Boolean).length : 0;
    wordCountEl.textContent = `Words: ${wordCount}`;
    const statusText = currentFileName + (isDirty ? "*" : "");
    fileStatusEl.textContent = statusText;
    fileStatusEl.title = `Current file: ${currentFileName}${
      isDirty ? " (unsaved changes)" : ""
    }`; // Update tooltip
    document.title = statusText + " - Advanced Notepad";
  }

  function updateSaveStatus(message, isError = false) {
    saveStatusEl.textContent = message;
    saveStatusEl.style.color = isError ? "#e74c3c" : "inherit"; // Use a distinct error color
    saveStatusEl.title = message; // Update tooltip

    // Clear message after a delay, unless it's an error or persistent state
    if (!isError && message !== "Unsaved changes") {
      // Don't auto-clear 'Unsaved changes'
      setTimeout(() => {
        if (saveStatusEl.textContent === message) {
          // Optionally clear or revert to 'Ready' or last saved state
          // saveStatusEl.textContent = isDirty ? 'Unsaved changes' : 'Ready';
          // saveStatusEl.title = isDirty ? 'Unsaved changes' : 'Ready';
        }
      }, 5000);
    }
  }

  function resetEditorState(fileName = "Untitled", fileHandle = null) {
    currentFileName = fileName;
    currentFileHandle = fileHandle;
    isDirty = false;
    clearTimeout(autosaveTimer);
    updateStatusBar();
    if (quill && quill.history) {
      quill.history.clear();
    }
  }

  // --- Autosave ---
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosave, AUTOSAVE_INTERVAL);
  }

  function autosave() {
    if (!isDirty) return;

    try {
      // Autosave STILL saves Delta (JSON) to preserve formatting for recovery,
      // even if the final save target is .txt. This is generally desired.
      const autoSaveData = {
        fileName: currentFileName,
        contentDelta: quill.getContents(),
        timestamp: Date.now(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(autoSaveData));
      updateSaveStatus("Draft autosaved");
    } catch (error) {
      console.error("Error during autosave:", error);
      if (error.name === "QuotaExceededError") {
        updateSaveStatus("Autosave failed: Storage full", true);
        alert(
          "Autosave failed: Browser storage is full. Please save your work manually."
        );
      } else {
        updateSaveStatus("Autosave failed", true);
      }
    }
  }

  function loadAutosavedDraft() {
    const savedDraftJSON = localStorage.getItem(AUTOSAVE_KEY);
    if (savedDraftJSON) {
      let draftData;
      try {
        draftData = JSON.parse(savedDraftJSON);
        if (!draftData || !draftData.contentDelta)
          throw new Error("Invalid draft format");

        const promptMsg = `An autosaved draft for "${
          draftData.fileName || "Untitled"
        }" from ${new Date(
          draftData.timestamp || 0
        ).toLocaleString()} was found. Restore it? (Formatting will be restored, but saving will follow the original file type or default to text)`;

        if (confirm(promptMsg)) {
          quill.setContents(draftData.contentDelta);
          isDirty = true; // Mark dirty as it needs saving
          updateStatusBar();
          updateSaveStatus("Restored autosaved draft");
          // Keep original filename/handle state, let user decide save format
        } else {
          localStorage.removeItem(AUTOSAVE_KEY);
        }
      } catch (err) {
        console.error("Error parsing autosaved draft:", err);
        alert(
          "Could not restore autosaved draft. It might be corrupted. Removing it."
        );
        localStorage.removeItem(AUTOSAVE_KEY);
      }
    }
  }

  // --- Theme ---
  function applyTheme(theme) {
    body.classList.toggle("dark-theme", theme === "dark");
    btnTheme.textContent = theme === "dark" ? "☀️" : "🌓";
    btnTheme.title =
      theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme";
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    const currentTheme = body.classList.contains("dark-theme")
      ? "dark"
      : "light";
    applyTheme(currentTheme === "dark" ? "light" : "dark");
  }

  function loadInitialTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const preferredTheme =
      savedTheme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    applyTheme(preferredTheme);
  }

  // --- File System API Check & Permissions ---
  function checkFileSystemApiSupport(isSaveOperation = false) {
    const supportsApi =
      "showOpenFilePicker" in window && "showSaveFilePicker" in window;
    if (!supportsApi) {
      alert(
        "Warning: Your browser lacks full support for the modern File System Access API. File operations may be limited or unavailable. Consider using Chrome, Edge, or Opera."
      );
      return false;
    }
    if (!window.isSecureContext) {
      console.warn(
        "File System Access API runs best in a secure context (HTTPS or localhost). Some features might behave differently."
      );
    }
    return true;
  }

  async function checkWritePermission(fileHandle) {
    if (!fileHandle) return false;
    const options = { mode: "readwrite" };
    try {
      if ((await fileHandle.queryPermission(options)) === "granted")
        return true;
      if ((await fileHandle.requestPermission(options)) === "granted")
        return true;
      return false;
    } catch (err) {
      console.error("Error checking/requesting write permission:", err);
      return false;
    }
  }

  // --- Initialization ---
  loadInitialTheme();
  initializeQuill();
  loadAutosavedDraft();
  updateStatusBar();
  updateSaveStatus("Ready");
  checkFileSystemApiSupport();
}); // End DOMContentLoaded

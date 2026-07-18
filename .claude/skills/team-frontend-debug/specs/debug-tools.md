

# Chrome DevTools MCP Usage Patterns

Reference for debug tool usage across all roles. Reproducer and Verifier are primary consumers.

## 1. Navigation & Page Control

### Navigate to URL
```
mcp__chrome-devtools__navigate_page({ type: "url", url: "http://localhost:3000/page" })
```

### Wait for Page Load
```
mcp__chrome-devtools__wait_for({ text: ["Expected Text"], timeout: 10000 })
```

### Reload Page
```
mcp__chrome-devtools__navigate_page({ type: "reload" })
```

### List Open Pages
```
mcp__chrome-devtools__list_pages()
```

### Select Page
```
mcp__chrome-devtools__select_page({ pageId: 0 })
```

## 2. User Interaction Simulation

### Click Element
```
// First take snapshot to find uid
mcp__chrome-devtools__take_snapshot()
// Then click by uid
mcp__chrome-devtools__click({ uid: "<uid-from-snapshot>" })
```

### Fill Input
```
mcp__chrome-devtools__fill({ uid: "<uid>", value: "input text" })
```

### Fill Multiple Fields
```
mcp__chrome-devtools__fill_form({
  elements: [
    { uid: "<uid1>", value: "value1" },
    { uid: "<uid2>", value: "value2" }
  ]
})
```

### Hover Element
```
mcp__chrome-devtools__hover({ uid: "<uid>" })
```

### Press Key
```
mcp__chrome-devtools__press_key({ key: "Enter" })
mcp__chrome-devtools__press_key({ key: "Control+A" })
```

### Type Text
```
mcp__chrome-devtools__type_text({ text: "typed content", submitKey: "Enter" })
```

## 3. Evidence Collection

### Screenshot
```
// Full viewport
mcp__chrome-devtools__take_screenshot({ filePath: "{run_dir}/evidence/screenshot.png" })

// Full page
mcp__chrome-devtools__take_screenshot({ filePath: "<path>", fullPage: true })

// Specific element
mcp__chrome-devtools__take_screenshot({ uid: "<uid>", filePath: "<path>" })
```

### DOM/A11y Snapshot
```
// Standard snapshot
mcp__chrome-devtools__take_snapshot()

// Verbose (all a11y info)
mcp__chrome-devtools__take_snapshot({ verbose: true })

// Save to file
mcp__chrome-devtools__take_snapshot({ filePath: "{run_dir}/evidence/snapshot.txt" })
```

### Console Messages
```
// All messages
mcp__chrome-devtools__list_console_messages()

// Errors and warnings only
mcp__chrome-devtools__list_console_messages({ types: ["error", "warn"] })

// Get specific message detail
mcp__chrome-devtools__get_console_message({ msgid: 5 })
```

### Network Requests
```
// All requests
mcp__chrome-devtools__list_network_requests()

// XHR/Fetch only (API calls)
mcp__chrome-devtools__list_network_requests({ resourceTypes: ["xhr", "fetch"] })

// Get request detail (headers, body, response)
mcp__chrome-devtools__get_network_request({ reqid: 3 })

// Save response to file
mcp__chrome-devtools__get_network_request({ reqid: 3, responseFilePath: "<path>" })
```

### Performance Trace
```
// Start trace (auto-reload and auto-stop)
mcp__chrome-devtools__performance_start_trace({ reload: true, autoStop: true })

// Start manual trace
mcp__chrome-devtools__performance_start_trace({ reload: false, autoStop: false })

// Stop and save
mcp__chrome-devtools__performance_stop_trace({ filePath: "{run_dir}/evidence/trace.json" })
```

## 4. Script Execution

### Evaluate JavaScript
```
// Get page title
mcp__chrome-devtools__evaluate_script({ function: "() => document.title" })

// Get element state
mcp__chrome-devtools__evaluate_script({
  function: "(el) => ({ text: el.innerText, classes: el.className })",
  args: ["<uid>"]
})

// Check React state (if applicable)
mcp__chrome-devtools__evaluate_script({
  function: "() => { const fiber = document.querySelector('#root')._reactRootContainer; return fiber ? 'React detected' : 'No React'; }"
})

// Get computed styles
mcp__chrome-devtools__evaluate_script({
  function: "(el) => JSON.stringify(window.getComputedStyle(el))",
  args: ["<uid>"]
})
```

## 5. Common Debug Patterns

### Pattern: Reproduce Click Bug
```
1. navigate_page → target URL
2. wait_for → page loaded
3. take_snapshot → find target element uid
4. take_screenshot → before state
5. list_console_messages → baseline errors
6. click → target element
7. wait_for → expected result (or timeout)
8. take_screenshot → after state
9. list_console_messages → new errors
10. list_network_requests → triggered requests
```

### Pattern: Debug API Error
```
1. navigate_page → target URL
2. wait_for → page loaded
3. take_snapshot → find trigger element
4. click/fill → trigger API call
5. list_network_requests → find the API request
6. get_network_request → inspect headers, body, response
7. list_console_messages → check for error handling
```

### Pattern: Debug Performance Issue
```
1. navigate_page → target URL (set URL first)
2. performance_start_trace → start recording with reload
3. (auto-stop after page loads)
4. Read trace results → identify long tasks, bottlenecks
```

### Pattern: Debug Visual/CSS Issue
```
1. navigate_page → target URL
2. take_screenshot → capture current visual state
3. take_snapshot({ verbose: true }) → full a11y tree with styles
4. evaluate_script → get computed styles of problematic element
5. Compare expected vs actual styles
```

## 6. Error Handling

| Error | Meaning | Resolution |
|-------|---------|------------|
| "No page selected" | No browser tab active | list_pages → select_page |
| "Element not found" | uid is stale | take_snapshot → get new uid |
| "Navigation timeout" | Page didn't load | Check URL, retry with longer timeout |
| "Evaluation failed" | JS error in script | Check script syntax, page context |
| "No trace recording" | stop_trace without start | Ensure start_trace was called first |

export const QUESTION_STORAGE_KEY = "starbound-run.questions.v1";
export const MAX_QUESTIONS = 200;

export const SAMPLE_QUESTIONS = [
  { question: "Which planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Mercury"], answer: "B", explanation: "Iron-rich dust gives Mars its reddish appearance." },
  { question: "What is the largest ocean on Earth?", options: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean", "Pacific Ocean"], answer: "D" },
  { question: "What is the chemical symbol for gold?", options: ["Ag", "Gd", "Au", "Go"], answer: "C" },
  { question: "Who wrote Romeo and Juliet?", options: ["Charles Dickens", "Jane Austen", "William Shakespeare", "Mark Twain"], answer: "C" },
  { question: "How many sides does a hexagon have?", options: ["Five", "Six", "Seven", "Eight"], answer: "B" },
];

export function validateQuestion(entry, number) {
  const errors = [];
  const question = typeof entry?.question === "string" ? entry.question.trim() : "";
  if (!question) errors.push(`Question ${number}: question text is required`);
  else if (question.length > 200) errors.push(`Question ${number}: question must be 200 characters or fewer`);

  const options = Array.isArray(entry?.options) ? entry.options.map((option) => typeof option === "string" ? option.trim() : "") : [];
  if (options.length !== 4) errors.push(`Question ${number}: exactly 4 options are required`);
  else {
    options.forEach((option, index) => {
      if (!option) errors.push(`Question ${number}: option ${String.fromCharCode(65 + index)} is required`);
      else if (option.length > 100) errors.push(`Question ${number}: each option must be 100 characters or fewer`);
    });
    if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      errors.push(`Question ${number}: all 4 options must be distinct`);
    }
  }

  const answer = typeof entry?.answer === "string" ? entry.answer.trim().toUpperCase() : "";
  if (!["A", "B", "C", "D"].includes(answer)) errors.push(`Question ${number}: answer must be A, B, C or D`);
  if (errors.length) return { errors };

  const result = { question, options, answer };
  if (typeof entry.source === "string" && entry.source.trim()) result.source = entry.source.trim();
  if (typeof entry.explanation === "string" && entry.explanation.trim()) result.explanation = entry.explanation.trim();
  return { question: result, errors };
}

export function loadQuestionBank() {
  try {
    const raw = localStorage.getItem(QUESTION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_QUESTIONS).map((item, index) => validateQuestion(item, index + 1))
      .filter((result) => result.errors.length === 0).map((result) => result.question);
  } catch {
    return [];
  }
}

export function saveQuestionBank(questions) {
  try {
    localStorage.setItem(QUESTION_STORAGE_KEY, JSON.stringify(questions.slice(0, MAX_QUESTIONS)));
    return true;
  } catch {
    return false;
  }
}

function extractJsonArray(text) {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "[") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const char = text[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "[") depth += 1;
      else if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(parsed)) return { found: true, rows: parsed, errors: [] };
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

export function parseQuestionInput(text) {
  const source = String(text ?? "").trim();
  if (!source) return { rows: [], errors: ["Paste questions or load a JSON/CSV file first."] };
  const json = extractJsonArray(source);
  if (json) return json;

  if (!globalThis.Papa?.parse) return { rows: [], errors: ["CSV parser did not load. Refresh the page and try again."] };
  try {
    const parsed = globalThis.Papa.parse(source, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    });
    const errors = (parsed.errors || []).map((error) => `CSV row ${(error.row ?? 0) + 2}: ${error.message}`);
    const required = ["question", "A", "B", "C", "D", "answer"];
    const fields = parsed.meta?.fields || [];
    const missing = required.filter((field) => !fields.includes(field));
    if (missing.length) return { rows: [], errors: [`CSV header must be question,A,B,C,D,answer. Missing: ${missing.join(", ")}.`] };
    const rows = (parsed.data || []).map((row) => ({
      question: row.question,
      options: [row.A, row.B, row.C, row.D],
      answer: row.answer,
    }));
    return { rows, errors };
  } catch {
    return { rows: [], errors: ["Could not read this input as JSON or CSV. Check its format and try again."] };
  }
}

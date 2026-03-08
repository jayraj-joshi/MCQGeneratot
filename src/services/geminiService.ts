import { GoogleGenAI, Type } from "@google/genai";

export interface MCQ {
  exam: string[];
  page: string[];
  board: string;
  grade: string;
  answer: string;
  options: string[];
  subject: string;
  language: string;
  question: string;
  difficulty: string;
  explanation: string;
  topic_number: string;
  topic_name: string;
  question_type: string;
  chapter_number: string;
  chapter_name: string;
  subtopics_number: string[];
  generated_by: string;
}

export interface DiagramResult {
  id: string;
  fileName: string;
  preview: string;
  questions: MCQ[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  tokens?: {
    prompt: number;
    candidates: number;
    total: number;
  };
}

export interface Batch {
  id: string;
  context: string;
  contextFileName: string;
  questionType: 'bdbq' | 'cdbq';
  diagrams: DiagramResult[];
  status: 'idle' | 'loading' | 'success' | 'error';
  totalTokens?: number;
}

const BATCH_MCQ_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          diagram_id: { type: Type.STRING, description: "The unique ID of the diagram this set of questions belongs to" },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                exam: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of exams like ['NEET'] or ['NEET', 'JEE']" },
                page: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Page numbers from NCERT" },
                board: { type: Type.STRING, description: "Board name, e.g., 'NCERT'" },
                grade: { type: Type.STRING, description: "Grade level, e.g., '12'" },
                answer: { type: Type.STRING, description: "The correct answer text" },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Exactly 4 options" },
                subject: { type: Type.STRING, description: "Subject name, e.g., 'Chemistry'" },
                language: { type: Type.STRING, description: "Language, e.g., 'English'" },
                question: { type: Type.STRING, description: "The MCQ question text" },
                difficulty: { type: Type.STRING, description: "Difficulty level: easy, medium, hard" },
                explanation: { type: Type.STRING, description: "Detailed explanation" },
                topic_number: { type: Type.STRING, description: "Topic number from NCERT" },
                topic_name: { type: Type.STRING, description: "Topic name from NCERT" },
                question_type: { type: Type.STRING, description: "Question type code" },
                chapter_number: { type: Type.STRING, description: "Chapter number" },
                chapter_name: { type: Type.STRING, description: "Chapter name from NCERT" },
                subtopics_number: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of subtopic numbers" },
                generated_by: { type: Type.STRING, description: "Entity that generated the question" }
              },
              required: [
                "exam", "page", "board", "grade", "answer", "options", "subject", 
                "language", "question", "difficulty", "explanation", "topic_number", 
                "topic_name", "question_type", "chapter_number", "chapter_name", 
                "subtopics_number", "generated_by"
              ]
            }
          }
        },
        required: ["diagram_id", "questions"]
      }
    }
  },
  required: ["results"]
};

export async function generateMCQsForDiagramBatch(
  diagrams: { id: string, base64: string, fileName: string }[],
  ncertContext: string,
  questionType: 'bdbq' | 'cdbq'
): Promise<{ 
  results: { [diagramId: string]: MCQ[] }, 
  usage: { promptTokens: number, candidatesTokens: number, totalTokens: number } 
}> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const exams = questionType === 'bdbq' ? '["NEET"]' : '["NEET", "JEE"]';
  const diagramList = diagrams.map(d => `- ID: ${d.id}, Name: ${d.fileName}`).join('\n');

  const prompt = `
    You are an expert curriculum developer and assessment specialist in Biology. Your task is to generate 20 high-quality, scientifically accurate multiple-choice questions (MCQs) for EACH of the provided diagrams.
    
    You are provided with:
    1. Multiple Diagrams/Figures: Visual representations of biological structures.
    2. Textbook/Reference Text: Excerpts from a textbook detailing the anatomy, function, and classification related to the diagrams.

    TEXTBOOK CONTEXT:
    ${ncertContext}
    
    DIAGRAMS TO PROCESS:
    ${diagramList}

    QUESTION TYPE REQUESTED: ${questionType}

    ### IMPORTANT: Mapping Questions to Diagrams
    You MUST generate a separate set of 20 questions for EACH diagram provided. 
    In the output JSON, you must map each set of questions to the correct "diagram_id" provided in the list above.

    ### Question Creation Requirements (Per Diagram)
    Each of the 20 questions must meet these strict criteria:

    1. Diagram-Centric Integration (MANDATORY)
    Every question MUST explicitly reference the specific diagram or figure (e.g., "In the provided diagram," "As illustrated in the figure"). The questions should be unanswerable without looking at the image.

    Expected Question Style (DO THIS):
    - "In the provided diagram (a), the vascular tissues are arranged in which specific pattern where xylem and phloem alternate along different radii?"
    - "The radial arrangement of vascular bundles, as illustrated in figure (a), is a characteristic feature of which plant organ?"

    Avoid This Style (DON'T DO THIS):
    - "In grasses, which specialized epidermal cells modify themselves to become large, empty, and colourless to regulate leaf rolling?" (Too text-heavy, no diagram reference)
    - "What is the collective name for the thin-walled, chloroplast-containing ground tissue cells in a leaf?" (Pure recall, doesn't use the image)

    Standalone Phrasing:
    While you MUST reference the diagram, DO NOT explicitly reference "the textbook," "the provided text," "the context," or "the excerpt" in the question, options, or EXPLANATION. The question and its explanation should feel like standalone exam content that uses the provided figure as its primary evidence.
    - Bad Explanation: "As stated in the text and shown in figure 19.4 (a), our body has one pair of adrenal glands..."
    - Good Explanation: "The human body possesses one pair of adrenal glands, with each gland positioned at the anterior (superior) part of each kidney, as illustrated in the provided diagram."

    2. Difficulty Distribution
    Generate a mix of difficulty levels:
    - 30% Easy/Recall: Identification of structures and labels shown clearly in both sources.
    - 40% Intermediate/Conceptual: Connecting visual evidence to functional explanations.
    - 30% Advanced/Analytical: Comparing different structures based on biological rules, or identifying misconceptions.

    3. Plausible Distractors (Wrong Answers)
    Do not use "None of the above" or "All of the above." Distractors must be common biological misconceptions or logical misinterpretations. For advanced questions, use complex multiple-selection distractors (e.g., "Statements I and III only").

    4. Scientific Precision
    The phrasing must be technically exact according to the text provided. Use standard biological nomenclature.

    ### CRITICAL INSTRUCTIONS FOR JSON FIELDS:
    - "exam": Use ${exams}
    - "question_type": Use "${questionType}"
    - "board": Use "NCERT"
    - "language": Use "English"
    - "options": Must have exactly 4 options.
    - "answer": Must be one of the options.
    - "difficulty": Use "easy", "medium", or "hard".
    - "generated_by": Use "OCM".
    - "page", "grade", "subject", "topic_number", "topic_name", "chapter_number", "chapter_name", "subtopics_number": Extract these from the NCERT context provided.

    Output the result as a JSON object containing an array "results", where each item has "diagram_id" and its corresponding "questions" array.
  `;

  const imageParts = diagrams.map(d => ({
    inlineData: {
      mimeType: "image/jpeg",
      data: d.base64.split(',')[1] || d.base64
    }
  }));

  const models = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-3.1-flash-lite-preview"];
  let lastError: any = null;

  for (const modelName of models) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            parts: [
              { text: prompt },
              ...imageParts
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: BATCH_MCQ_SCHEMA
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = JSON.parse(text);
      
      const resultMapping: { [diagramId: string]: MCQ[] } = {};
      parsed.results.forEach((res: any) => {
        resultMapping[res.diagram_id] = res.questions;
      });
      
      return {
        results: resultMapping,
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          candidatesTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (e: any) {
      lastError = e;
      const isRateLimit = e.status === 429 || 
                         e.message?.includes('429') || 
                         e.message?.toLowerCase().includes('rate limit');
      
      if (isRateLimit) {
        console.warn(`Model ${modelName} failed with 429. Retrying with next fallback...`);
        continue;
      }
      // If it's not a rate limit error, we might still want to try fallback if the user implies general resilience,
      // but they specifically asked for 429 logic.
      throw e;
    }
  }

  throw lastError || new Error("Failed to generate MCQs after all fallbacks.");
}


import { GoogleGenAI } from "@google/genai";
import { RefinementResult } from "../types";

const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables");
  }
  return new GoogleGenAI({ apiKey });
};

const STAGE0_PROMPT = `
SYSTEM INSTRUCTION:
You are the STAGE 0 component of a signature-animation pipeline.

GOAL:
Denoise and enhance the image quality STRICTLY WITHOUT ALTERING GEOMETRY.

RULES:
- INPUT IS TRUTH. Do not reshape letters. Do not fix wobbly lines.
- Remove salt-and-pepper noise, JPEG artifacts, and background shadows.
- Increase contrast: Ink = Black, Paper = White.
- If the signature has faint lines, strengthen them, but do not move them.
- Output ONLY the processed image.
`;

// Helper to handle AI errors gracefully
const handleError = (error: any, context: string): never => {
  console.error(`AI Error (${context}):`, error);
  
  let message = error.message || "An unexpected error occurred.";
  
  if (message.includes("API key")) {
    message = "Invalid or missing API Key. Please check your configuration.";
  } else if (message.includes("429")) {
    message = "Rate limit exceeded. Please wait a moment before trying again.";
  } else if (message.includes("SAFETY")) {
    message = "The content was flagged by safety filters. Please try a different image.";
  } else if (message.includes("503")) {
    message = "AI service is temporarily unavailable. Please try again later.";
  }

  throw new Error(message);
};

export const refineSignature = async (base64Image: string): Promise<RefinementResult> => {
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image.split(',')[1],
            },
          },
          {
            text: STAGE0_PROMPT,
          },
        ],
      },
    });

    let imageUrl = "";
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        imageUrl = `data:image/png;base64,${part.inlineData.data}`;
      }
    }

    if (!imageUrl) {
      throw new Error("No image generated.");
    }

    return {
      imageUrl,
      metadata: {
        resolution: "Standard",
        refinement_strength: 0.5,
        num_gaps_repaired: 0,
        note: "Refinement complete"
      }
    };
  } catch (e) {
    handleError(e, "Refinement");
  }
};

export const editSignature = async (base64Image: string, prompt: string): Promise<string> => {
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image.split(',')[1],
            },
          },
          {
            text: `Edit this image: ${prompt}`,
          },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error("No edited image generated.");
  } catch (e) {
    handleError(e, "Editing");
  }
};

export const generateRapidInsight = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAIClient();
    // Using gemini-flash-lite-latest (mapped from gemini-2.5-flash-lite request) for low latency
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image.split(',')[1],
            },
          },
          {
            text: "Analyze this signature. In 1 very short sentence, describe its style (e.g., 'Formal cursive', 'Rapid scrawl', 'Geometric') and legibility.",
          },
        ],
      },
    });
    
    return response.text || "Analysis complete.";
  } catch (e) {
    console.warn("Rapid insight failed", e);
    return "Local analysis only.";
  }
};

import { generateText, Output } from "ai";
import { z } from "zod";
import { TEXT_MODEL } from "./models";

export const SDS_SECTION_TITLES = [
  "Identification",
  "Hazard(s) identification",
  "Composition/information on ingredients",
  "First-aid measures",
  "Fire-fighting measures",
  "Accidental release measures",
  "Handling and storage",
  "Exposure controls/personal protection",
  "Physical and chemical properties",
  "Stability and reactivity",
  "Toxicological information",
  "Ecological information",
  "Disposal considerations",
  "Transport information",
  "Regulatory information",
  "Other information",
] as const;

const sdsSchema = z.object({
  revisionDate: z.string().nullable().describe("Revision or issue date in ISO format (YYYY-MM-DD) if stated"),
  summary: z
    .string()
    .describe("Three to five sentence plain-language summary of the main hazards and required protections"),
  sections: z
    .array(
      z.object({
        number: z.number().int().min(1).max(16),
        title: z.string(),
        content: z.string().describe("Faithful condensed text of the section, preserving codes, values and units"),
      }),
    )
    .describe("All 16 GHS SDS sections in order. Use an empty string when a section is missing."),
});

export type ParsedSds = z.infer<typeof sdsSchema>;

export async function parseSdsPdf(pdf: Uint8Array): Promise<ParsedSds> {
  const { output } = await generateText({
    model: TEXT_MODEL,
    output: Output.object({ schema: sdsSchema }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Extract this Safety Data Sheet into the 16 standard GHS sections:",
              SDS_SECTION_TITLES.map((t, i) => `${i + 1}. ${t}`).join("\n"),
              "Do not invent values. Keep H/P statement codes, CAS numbers, exposure limits and physical constants exactly as written.",
            ].join("\n\n"),
          },
          { type: "file", mediaType: "application/pdf", data: pdf, filename: "sds.pdf" },
        ],
      },
    ],
  });
  return output;
}

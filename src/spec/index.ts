import type { components } from "./schema.d.ts";

type Schemas = components["schemas"];

export type AmountFraction = Schemas["AmountFraction"];
export type AmountNumber = Schemas["AmountNumber"];
export type AmountRange = Schemas["AmountRange"];
export type ExtractedRecipeIngredientItem =
    Schemas["ExtractedRecipeIngredientItem"];
export type ExtractedRecipeIngredientSection =
    Schemas["ExtractedRecipeIngredientSection"];
export type ExtractedRecipeMetadata = Schemas["ExtractedRecipeMetadata"];
export type NormalizedExtractedRecipe = Schemas["ExtractedRecipe"];
export type RecipeMethodSection = Schemas["RecipeMethodSection"];
export type Servings = Schemas["Servings"];
export type TagCandidates = Schemas["TagCandidates"];

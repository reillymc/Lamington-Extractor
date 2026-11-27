import { describe, it } from "node:test";
import { expect } from "expect";
import type { Recipe } from "schema-dts";
import { ExtractionLimitError } from "../../src/errors.ts";
import type { NormalizedExtractedRecipe } from "../../src/spec/index.ts";
import {
    MAX_AMOUNT_VALUE_LENGTH,
    MAX_EXTRACTED_INGREDIENTS,
    MAX_EXTRACTED_NAME_LENGTH,
    MAX_EXTRACTED_SECTIONS,
    MAX_EXTRACTED_SOURCE_LENGTH,
    MAX_EXTRACTED_SUMMARY_LENGTH,
    MAX_IMAGES,
    MAX_INGREDIENT_NAME_LENGTH,
    MAX_INGREDIENT_PREPARATION_LENGTH,
    MAX_INGREDIENT_TEXT_LENGTH,
    MAX_INGREDIENT_VARIANTS,
    MAX_INGREDIENTS_PER_SECTION,
    MAX_METHOD_ITEMS,
    MAX_METHOD_ITEMS_PER_SECTION,
    MAX_METHOD_TEXT_LENGTH,
    MAX_RECIPE_GRAPH_DEPTH,
    MAX_RECIPE_GRAPH_NODES,
    MAX_SECTION_NAME_LENGTH,
    MAX_TAG_CANDIDATES,
} from "../../src/utils/extractionLimits.ts";
import {
    convertRecipe,
    findRecipe,
    isRecipe,
} from "../../src/utils/recipeConverter.ts";
import { runTestCases, type TestCase } from "../helpers/index.ts";

describe("isRecipe", () => {
    const testCases: TestCase[] = [
        {
            name: "should return true for valid input",
            input: { "@type": "Recipe" },
            expected: true,
        },
        {
            name: "should return true for array type input",
            input: { "@type": ["Recipe", "CreativeWork"] },
            expected: true,
        },
        {
            name: "should return false for null input",
            input: null as unknown as object,
            expected: false,
        },
        {
            name: "should return false for empty object",
            input: {},
            expected: false,
        },
        {
            name: "should return false for wrong type",
            input: { "@type": "Person" },
            expected: false,
        },
    ];

    runTestCases(testCases, ({ input, expected }) => {
        expect(isRecipe(input)).toBe(expected);
    });
});

describe("findRecipe", () => {
    const recipe = { "@type": "Recipe", name: "Test" };

    const testCases: TestCase[] = [
        {
            name: "should return recipe if input is recipe",
            input: recipe,
            expected: recipe,
        },
        {
            name: "should find recipe in array",
            input: [recipe],
            expected: recipe,
        },
        {
            name: "should find recipe in @graph",
            input: { "@context": "https://schema.org", "@graph": [recipe] },
            expected: recipe,
        },
        {
            name: "should find recipe nested in array and graph",
            input: [{ "@graph": [recipe] }],
            expected: recipe,
        },
        {
            name: "should find recipe in @graph as object",
            input: { "@context": "https://schema.org", "@graph": recipe },
            expected: recipe,
        },
        {
            name: "should return undefined if no recipe found",
            input: { "@type": "Person" },
            expected: undefined,
        },
    ];

    runTestCases(testCases, ({ input, expected }) => {
        expect(findRecipe(input)).toEqual(expected);
    });

    it("should reject recipe data nested beyond the depth limit", () => {
        let input: unknown = { "@type": "Person" };
        for (let depth = 0; depth <= MAX_RECIPE_GRAPH_DEPTH; depth += 1) {
            input = [input];
        }

        expect(() => findRecipe(input)).toThrow(ExtractionLimitError);
    });

    it("should reject recipe data with too many graph nodes", () => {
        const input = Array.from(
            { length: MAX_RECIPE_GRAPH_NODES + 1 },
            () => ({ "@type": "Person" }),
        );

        expect(() => findRecipe(input)).toThrow(ExtractionLimitError);
    });

    it("should share the graph budget across searches", () => {
        const budget = { visited: MAX_RECIPE_GRAPH_NODES - 1 };
        const input = { "@type": "Person" };

        findRecipe(input, budget);

        expect(() => findRecipe(input, budget)).toThrow(ExtractionLimitError);
    });
});

describe("convertRecipe", () => {
    const baseRecipe: Recipe = {
        "@type": "Recipe",
        name: "Test Recipe",
    };

    it("should extract recipe name", () => {
        const result = convertRecipe(baseRecipe);
        expect(result.name).toBe("Test Recipe");
    });

    describe("source", () => {
        const testCases: TestCase<NormalizedExtractedRecipe["source"]>[] = [
            {
                name: "should extract recipe source from id property",
                input: { "@id": "https://example.com/recipe" },
                expected: "https://example.com/recipe",
            },
            {
                name: "should extract recipe source from url property if @id is missing",
                input: { url: "https://example.com/recipe-url" },
                expected: "https://example.com/recipe-url",
            },
            {
                name: "should extract recipe source from mainEntityOfPage if @id and url are missing",
                input: {
                    mainEntityOfPage: {
                        "@type": "WebPage",
                        "@id": "https://example.com/recipe-main-entity",
                    },
                },
                expected: "https://example.com/recipe-main-entity",
            },
        ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });
            expect(result.source).toBe(expected);
        });
    });

    it("should extract recipe summary", () => {
        const recipe: Recipe = {
            "@type": "Recipe",
            name: "Summary Test",
            description: "A delicious test recipe.",
        };
        const result = convertRecipe(recipe);
        expect(result.summary).toBe("A delicious test recipe.");
    });

    describe("extraction limits", () => {
        it("should reject too many ingredients", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeIngredient: Array.from(
                    { length: MAX_EXTRACTED_INGREDIENTS + 1 },
                    () => "flour",
                ),
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should split the maximum ingredient count into bounded sections", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeIngredient: Array.from(
                    { length: MAX_EXTRACTED_INGREDIENTS },
                    (_, index) => `Ingredient ${index}`,
                ),
            };

            const result = convertRecipe(recipe);

            expect(result.ingredients).toHaveLength(MAX_EXTRACTED_SECTIONS);
            expect(
                result.ingredients?.every(
                    (section) =>
                        section.items.length === MAX_INGREDIENTS_PER_SECTION,
                ),
            ).toBe(true);
        });

        it("should reject oversized ingredient text", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeIngredient: ["x".repeat(MAX_INGREDIENT_TEXT_LENGTH + 1)],
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should reject too many method items", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeInstructions: Array.from(
                    { length: MAX_METHOD_ITEMS + 1 },
                    (_, index) => `Step ${index}`,
                ),
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should split the maximum method count into bounded sections", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeInstructions: Array.from(
                    { length: MAX_METHOD_ITEMS },
                    (_, index) => `Step ${index}`,
                ),
            };

            const result = convertRecipe(recipe);

            expect(result.method).toHaveLength(MAX_EXTRACTED_SECTIONS);
            expect(
                result.method?.every(
                    (section) =>
                        section.items.length === MAX_METHOD_ITEMS_PER_SECTION,
                ),
            ).toBe(true);
        });

        it("should reject oversized method text", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeInstructions: ["x".repeat(MAX_METHOD_TEXT_LENGTH + 1)],
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should reject too many method sections", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeInstructions: Array.from(
                    { length: MAX_EXTRACTED_SECTIONS + 1 },
                    (_, index) => ({
                        "@type": "HowToSection",
                        name: `Section ${index}`,
                        itemListElement: ["Step"],
                    }),
                ),
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should reject too many images", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                image: Array.from(
                    { length: MAX_IMAGES + 1 },
                    (_, index) =>
                        `https://example.com/image-${index}.jpg` as string,
                ),
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should reject too many tag candidates", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                keywords: Array.from(
                    { length: MAX_TAG_CANDIDATES + 1 },
                    (_, index) => `tag-${index}`,
                ),
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should count tag candidates across recipe fields", () => {
            const recipe: Recipe = {
                ...baseRecipe,
                recipeCuisine: Array.from(
                    { length: MAX_TAG_CANDIDATES / 2 + 1 },
                    (_, index) => `cuisine-${index}`,
                ),
                recipeCategory: Array.from(
                    { length: MAX_TAG_CANDIDATES / 2 },
                    (_, index) => `category-${index}`,
                ),
            };

            expect(() => convertRecipe(recipe)).toThrow(ExtractionLimitError);
        });

        it("should reject oversized recipe fields", () => {
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    name: "x".repeat(MAX_EXTRACTED_NAME_LENGTH + 1),
                }),
            ).toThrow(ExtractionLimitError);
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    description: "x".repeat(MAX_EXTRACTED_SUMMARY_LENGTH + 1),
                }),
            ).toThrow(ExtractionLimitError);
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    "@id": "x".repeat(MAX_EXTRACTED_SOURCE_LENGTH + 1),
                }),
            ).toThrow(ExtractionLimitError);
        });

        it("should reject oversized parsed ingredient fields", () => {
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    recipeIngredient: [
                        "x".repeat(MAX_INGREDIENT_NAME_LENGTH + 1),
                    ],
                }),
            ).toThrow(ExtractionLimitError);
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    recipeIngredient: [
                        `1 item (${"x".repeat(MAX_INGREDIENT_PREPARATION_LENGTH + 1)})`,
                    ],
                }),
            ).toThrow(ExtractionLimitError);
        });

        it("should reject oversized amount values", () => {
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    recipeIngredient: [
                        `${"9".repeat(MAX_AMOUNT_VALUE_LENGTH + 1)} flour`,
                    ],
                }),
            ).toThrow(ExtractionLimitError);
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    recipeYield: "9".repeat(MAX_AMOUNT_VALUE_LENGTH + 1),
                }),
            ).toThrow(ExtractionLimitError);
        });

        it("should reject oversized method section names", () => {
            expect(() =>
                convertRecipe({
                    ...baseRecipe,
                    recipeInstructions: [
                        {
                            "@type": "HowToSection",
                            name: "x".repeat(MAX_SECTION_NAME_LENGTH + 1),
                            itemListElement: ["Step"],
                        },
                    ],
                }),
            ).toThrow(ExtractionLimitError);
        });
    });

    describe("prep time", () => {
        const testCases: TestCase<NormalizedExtractedRecipe["prepTime"]>[] = [
            {
                name: "should extract minutes",
                input: { prepTime: "PT20M" },
                expected: 20,
            },
            {
                name: "should extract hours",
                input: { prepTime: "PT1H" },
                expected: 60,
            },
            {
                name: "should extract minutes and hours",
                input: { prepTime: "PT1H30M" },
                expected: 90,
            },
            {
                name: "should extract days",
                input: { prepTime: "P1DT2H" },
                expected: 1560,
            },
            {
                name: "should extract from array",
                input: { prepTime: ["PT20M"] },
                expected: 20,
            },
            {
                name: "should return undefined for invalid duration",
                input: { prepTime: "invalid" },
                expected: undefined,
            },
        ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });
            expect(result.prepTime).toBe(expected);
        });
    });

    describe("cook time", () => {
        const testCases: TestCase<NormalizedExtractedRecipe["cookTime"]>[] = [
            {
                name: "should extract minutes",
                input: { cookTime: "PT20M" },
                expected: 20,
            },
            {
                name: "should extract hours",
                input: { cookTime: "PT1H" },
                expected: 60,
            },
            {
                name: "should extract minutes and hours",
                input: { cookTime: "PT1H30M" },
                expected: 90,
            },
            {
                name: "should extract days",
                input: { cookTime: "P1DT2H" },
                expected: 1560,
            },
            {
                name: "should extract from array",
                input: { cookTime: ["PT20M"] },
                expected: 20,
            },
        ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });
            expect(result.cookTime).toBe(expected);
        });
    });

    describe("servings", () => {
        const testCases: TestCase<NormalizedExtractedRecipe["servings"]>[] = [
            {
                name: "should extract string servings correctly",
                input: { recipeYield: "4" },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "",
                },
            },
            {
                name: "should extract string servings with unit correctly",
                input: { recipeYield: "4 People" },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "People",
                },
            },
            {
                name: "should extract number servings correctly",
                input: { recipeYield: 4 },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "",
                },
            },
            {
                name: "should extract array servings correctly",
                input: { recipeYield: ["4"] },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "",
                },
            },
            {
                name: "should extract most detailed of array servings correctly",
                input: { recipeYield: ["4 People"] },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "People",
                },
            },
            {
                name: "should extract range servings correctly",
                input: { recipeYield: "4 - 6" },
                expected: {
                    count: { representation: "range", value: ["4", "6"] },
                    unit: "",
                },
            },
            {
                name: "should extract range servings with unit correctly",
                input: { recipeYield: "4 - 6 People" },
                expected: {
                    count: { representation: "range", value: ["4", "6"] },
                    unit: "People",
                },
            },
            {
                name: "should extract range servings correctly with 'to' separator",
                input: { recipeYield: "4 to 6" },
                expected: {
                    count: { representation: "range", value: ["4", "6"] },
                    unit: "",
                },
            },
            {
                name: "should extract the most descriptive serving from an array",
                input: { recipeYield: ["4", "4 servings"] },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "servings",
                },
            },
            {
                name: "should extract servings from a string with a prefix",
                input: { recipeYield: "Yield: 12 muffins" },
                expected: {
                    count: { representation: "number", value: "12" },
                    unit: "muffins",
                },
            },
            {
                name: "should extract range servings from a string with a prefix",
                input: { recipeYield: "Makes: 8-10 cookies" },
                expected: {
                    count: { representation: "range", value: ["8", "10"] },
                    unit: "cookies",
                },
            },
            {
                name: "should truncate an excessively long single value unit",
                input: { recipeYield: `4 ${"x".repeat(300)}` },
                expected: {
                    count: { representation: "number", value: "4" },
                    unit: "x".repeat(255),
                },
            },
            {
                name: "should truncate an excessively long range unit",
                input: { recipeYield: `8-10 ${"x".repeat(300)}` },
                expected: {
                    count: { representation: "range", value: ["8", "10"] },
                    unit: "x".repeat(255),
                },
            },
            {
                name: "should handle parseYield with empty array",
                input: { recipeYield: [] },
                expected: undefined,
            },
            {
                name: "should handle parseYield with null value",
                input: { recipeYield: null as unknown as string },
                expected: undefined,
            },
            {
                name: "should return undefined for invalid yield",
                input: { recipeYield: "invalid" },
                expected: undefined,
            },
        ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });
            expect(result.servings).toEqual(expected);
        });
    });

    describe("image", () => {
        const testCases: TestCase<
            NonNullable<NormalizedExtractedRecipe["additionalData"]>["imageUrl"]
        >[] = [
            {
                name: "should extract simple string image url",
                input: { image: "https://example.com/image.jpg" },
                expected: "https://example.com/image.jpg",
            },
            {
                name: "should extract image url from ImageObject",
                input: {
                    image: {
                        "@type": "ImageObject",
                        url: "https://example.com/image.jpg",
                    },
                },
                expected: "https://example.com/image.jpg",
            },
            {
                name: "should extract image url from array of ImageObjects",
                input: {
                    image: [
                        {
                            "@type": "ImageObject",
                            url: "https://example.com/image1.jpg",
                        },
                    ],
                },
                expected: "https://example.com/image1.jpg",
            },
            {
                name: "should extract image url from contentUrl if url is missing",
                input: {
                    image: {
                        "@type": "ImageObject",
                        contentUrl: "https://example.com/content.jpg",
                    },
                },
                expected: "https://example.com/content.jpg",
            },
            {
                name: "should extract the largest image from an array of resized images",
                input: {
                    image: [
                        "https://example.com/image-225x225.jpg",
                        "https://example.com/image-260x195.jpg",
                        "https://example.com/image.jpg",
                        "https://example.com/image-320x180.jpg",
                    ],
                },
                expected: "https://example.com/image.jpg",
            },
            {
                name: "should prioritize image with largest dimensions specified in object",
                input: {
                    image: [
                        {
                            "@type": "ImageObject",
                            url: "https://example.com/small.jpg",
                            width: "100",
                            height: "100",
                        },
                        {
                            "@type": "ImageObject",
                            url: "https://example.com/large.jpg",
                            width: "1000",
                            height: "1000",
                        },
                    ],
                },
                expected: "https://example.com/large.jpg",
            },
            {
                name: "should handle image object with no url properties",
                input: {
                    image: {
                        "@type": "ImageObject",
                    },
                },
                expected: undefined,
            },
            {
                name: "should handle image array with mixed valid and invalid objects",
                input: {
                    image: [
                        {
                            "@type": "ImageObject",
                        },
                        "https://example.com/valid.jpg",
                        {
                            contentUrl: "https://example.com/content.jpg",
                        },
                    ],
                },
                expected: "https://example.com/valid.jpg",
            },
        ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });
            expect(result.additionalData!.imageUrl).toBe(expected);
        });
    });

    describe("method", () => {
        const testCases: TestCase<NormalizedExtractedRecipe["method"]>[] = [
            {
                name: "should parse string instructions",
                input: { recipeInstructions: ["Step 1", "Step 2"] },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Step 1" }, { content: "Step 2" }],
                    },
                ],
            },
            {
                name: "should parse HowToStep instructions",
                input: {
                    recipeInstructions: [
                        { "@type": "HowToStep", text: "Step 1" },
                        { "@type": "HowToStep", text: "Step 2" },
                    ],
                },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Step 1" }, { content: "Step 2" }],
                    },
                ],
            },
            {
                name: "should parse HowToStep instructions using name if text is missing",
                input: {
                    recipeInstructions: [
                        { "@type": "HowToStep", name: "Step 1 Name" },
                    ],
                },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Step 1 Name" }],
                    },
                ],
            },
            {
                name: "should parse HowToSection instructions",
                input: {
                    recipeInstructions: [
                        {
                            "@type": "HowToSection",
                            name: "Prep",
                            itemListElement: [
                                { "@type": "HowToStep", text: "Chop" },
                            ],
                        },
                        {
                            "@type": "HowToSection",
                            name: "Cook",
                            itemListElement: ["Fry"],
                        },
                    ],
                },
                expected: [
                    {
                        name: "Prep",
                        items: [{ content: "Chop" }],
                    },
                    {
                        name: "Cook",
                        items: [{ content: "Fry" }],
                    },
                ],
            },
            {
                name: "should handle single string instruction",
                input: { recipeInstructions: "Just cook it." },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Just cook it." }],
                    },
                ],
            },
            {
                name: "should handle mixed HowToSection and top-level steps",
                input: {
                    recipeInstructions: [
                        "Preheat oven",
                        {
                            "@type": "HowToSection",
                            name: "Bake",
                            itemListElement: ["Put in oven"],
                        },
                        "Cool down",
                    ],
                },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Preheat oven" }],
                    },
                    {
                        name: "Bake",
                        items: [{ content: "Put in oven" }],
                    },
                    {
                        name: "Method",
                        items: [{ content: "Cool down" }],
                    },
                ],
            },
            {
                name: "should parse multiple HowToSections with HowToSteps",
                input: {
                    recipeInstructions: [
                        {
                            "@type": "HowToSection",
                            name: "Preparation",
                            itemListElement: [
                                {
                                    "@type": "HowToStep",
                                    text: "Wash vegetables",
                                },
                                { "@type": "HowToStep", text: "Dice onions" },
                            ],
                        },
                        {
                            "@type": "HowToSection",
                            name: "Cooking",
                            itemListElement: [
                                { "@type": "HowToStep", text: "Heat oil" },
                                { "@type": "HowToStep", text: "Sauté onions" },
                            ],
                        },
                    ],
                },
                expected: [
                    {
                        name: "Preparation",
                        items: [
                            { content: "Wash vegetables" },
                            { content: "Dice onions" },
                        ],
                    },
                    {
                        name: "Cooking",
                        items: [
                            { content: "Heat oil" },
                            { content: "Sauté onions" },
                        ],
                    },
                ],
            },
            {
                name: "should handle instructions with plain object step (no @type)",
                input: {
                    recipeInstructions: [
                        {
                            text: "Step without type property",
                        },
                    ],
                },
                expected: [
                    {
                        name: "Method",
                        items: [
                            {
                                content: "Step without type property",
                            },
                        ],
                    },
                ],
            },
            {
                name: "should handle instructions with empty object",
                input: {
                    recipeInstructions: [{}, "Regular step"],
                },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Regular step" }],
                    },
                ],
            },
            {
                name: "should handle empty HowToSection with no itemListElement",
                input: {
                    recipeInstructions: [
                        {
                            "@type": "HowToSection",
                            name: "Prep",
                        },
                    ],
                },
                expected: [],
            },
            {
                name: "should ignore instructions with unknown type",
                input: {
                    recipeInstructions: [
                        { "@type": "UnknownType", text: "Should be ignored" },
                        "Valid step",
                    ],
                },
                expected: [
                    {
                        name: "Method",
                        items: [{ content: "Valid step" }],
                    },
                ],
            },
        ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });

            expect(result.method).toStrictEqual(expected);
        });
    });

    describe("ingredients", () => {
        const testCases: TestCase<NormalizedExtractedRecipe["ingredients"]>[] =
            [
                {
                    name: "should parse simple ingredient",
                    input: { recipeIngredient: ["Garlic"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "Garlic" }],
                        },
                    ],
                },
                {
                    name: "should parse simple hyphenated ingredient",
                    input: { recipeIngredient: ["Extra-virgin olive oil"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "Extra-virgin olive oil" }],
                        },
                    ],
                },
                {
                    name: "should parse simple slashed ingredient",
                    input: { recipeIngredient: ["sunflower / vegetable oil"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "sunflower / vegetable oil",
                                    variants: [
                                        "sunflower oil",
                                        "vegetable oil",
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should move leading preparation modifiers into preparation",
                    input: {
                        recipeIngredient: ["2 tbsp finely chopped parsley"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "parsley",
                                    unit: "tbsp",
                                    preparation: "finely chopped",
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should move size descriptors to description",
                    input: { recipeIngredient: ["1 small onion"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "onion",
                                    description: "small",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep preparing a trailing unit after a comma",
                    input: { recipeIngredient: ["garlic cloves, minced"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "garlic",
                                    unit: "cloves",
                                    preparation: "minced",
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep identity-distinguishing fresh in the name",
                    input: { recipeIngredient: ["fresh basil"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "fresh basil" }],
                        },
                    ],
                },
                {
                    name: "should keep an identity descriptor while moving preparation modifiers",
                    input: { recipeIngredient: ["fresh chopped parsley"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "fresh parsley",
                                    preparation: "chopped",
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should handle size and preparation modifiers in either order",
                    input: {
                        recipeIngredient: ["1 small finely chopped onion"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "onion",
                                    description: "small",
                                    preparation: "finely chopped",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep identity-distinguishing ground in the name",
                    input: { recipeIngredient: ["ground almonds"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "ground almonds" }],
                        },
                    ],
                },
                {
                    name: "should keep identity-distinguishing roasted in the name",
                    input: { recipeIngredient: ["roasted red peppers"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "roasted red peppers" }],
                        },
                    ],
                },
                {
                    name: "should keep preparation descriptors for canned chopped tomatoes",
                    input: { recipeIngredient: ["1 can chopped tomatoes"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "chopped tomatoes",
                                    unit: "can",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep preparation descriptors for canned crushed tomatoes",
                    input: { recipeIngredient: ["1 can crushed tomatoes"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "crushed tomatoes",
                                    unit: "can",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep preparation descriptors for canned diced tomatoes",
                    input: { recipeIngredient: ["1 can diced tomatoes"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "diced tomatoes",
                                    unit: "can",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep adverb preparation descriptors for canned tomatoes",
                    input: {
                        recipeIngredient: ["1 can finely chopped tomatoes"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "finely chopped tomatoes",
                                    unit: "can",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse plural packaging units for pre-prepared products",
                    input: {
                        recipeIngredient: ["2 cans of chopped tomatoes"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "chopped tomatoes",
                                    unit: "cans",
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep preparation descriptors for canned adjective products",
                    input: {
                        recipeIngredient: ["canned chopped tomatoes"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "canned chopped tomatoes" }],
                        },
                    ],
                },
                {
                    name: "should keep preparation descriptors for tinned adjective products",
                    input: {
                        recipeIngredient: ["tinned chopped tomatoes"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [{ name: "tinned chopped tomatoes" }],
                        },
                    ],
                },
                {
                    name: "should keep preparation descriptors for jarred products",
                    input: { recipeIngredient: ["1 jar chopped tomatoes"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "chopped tomatoes",
                                    unit: "jar",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse canned tomatoes without preparation descriptors",
                    input: { recipeIngredient: ["1 can tomatoes"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "tomatoes",
                                    unit: "can",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep explicit comma preparation for canned products",
                    input: {
                        recipeIngredient: ["1 can chopped tomatoes, drained"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "chopped tomatoes",
                                    unit: "can",
                                    preparation: "drained",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep explicit parenthetical preparation for canned products",
                    input: {
                        recipeIngredient: ["1 can chopped tomatoes (diced)"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "chopped tomatoes",
                                    unit: "can",
                                    preparation: "diced",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should expand slash alternatives for canned products",
                    input: {
                        recipeIngredient: ["1 can crushed / diced tomatoes"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "crushed / diced tomatoes",
                                    variants: [
                                        "crushed tomatoes",
                                        "diced tomatoes",
                                    ],
                                    unit: "can",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should still move preparation descriptors without packaging",
                    input: { recipeIngredient: ["1 chopped tomato"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "tomato",
                                    preparation: "chopped",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with number amount",
                    input: { recipeIngredient: ["1 Onion"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "Onion",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with number and unit",
                    input: { recipeIngredient: ["2 Tbsp olive oil"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "olive oil",
                                    unit: "tbsp",
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with number and unit without spaces",
                    input: { recipeIngredient: ["250g smooth ricotta"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "smooth ricotta",
                                    unit: "g",
                                    amount: {
                                        representation: "number",
                                        value: "250",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with number range",
                    input: {
                        recipeIngredient: ["2-3 slices of Halloumi cheese"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "slices of Halloumi cheese",
                                    amount: {
                                        representation: "range",
                                        value: ["2", "3"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with number range using 'to' separator",
                    input: {
                        recipeIngredient: ["2 to 3 slices of Halloumi cheese"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "slices of Halloumi cheese",
                                    amount: {
                                        representation: "range",
                                        value: ["2", "3"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with simple fraction",
                    input: { recipeIngredient: ["1/2 lemon"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "lemon",
                                    amount: {
                                        representation: "fraction",
                                        value: ["0", "1", "2"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with unicode fraction",
                    input: { recipeIngredient: ["¼ lemon"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "lemon",
                                    amount: {
                                        representation: "fraction",
                                        value: ["0", "1", "4"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with whole number and simple fraction",
                    input: { recipeIngredient: ["1 1/4 lemon"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "lemon",
                                    amount: {
                                        representation: "fraction",
                                        value: ["1", "1", "4"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with whole number and unicode fraction",
                    input: { recipeIngredient: ["1 ½ lemon"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "lemon",
                                    amount: {
                                        representation: "fraction",
                                        value: ["1", "1", "2"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with encoded fraction",
                    input: { recipeIngredient: ["&#8531 potato"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "potato",
                                    amount: {
                                        representation: "fraction",
                                        value: ["0", "1", "3"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with decimal fraction",
                    input: { recipeIngredient: ["0.25 cup grated parmesan"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "parmesan",
                                    unit: "cup",
                                    preparation: "grated",
                                    amount: {
                                        representation: "fraction",
                                        value: ["0", "1", "4"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with fraction range",
                    input: {
                        recipeIngredient: [
                            "¼-½ teaspoon crushed red pepper flakes",
                        ],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "red pepper flakes",
                                    unit: "teaspoon",
                                    preparation: "crushed",
                                    amount: {
                                        representation: "range",
                                        value: ["1/4", "1/2"],
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with notes (bracket denoted)",
                    input: { recipeIngredient: ["2  garlic cloves (minced)"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "garlic",
                                    unit: "cloves",
                                    preparation: "minced",
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with postfix garlic cloves unit and prep",
                    input: {
                        recipeIngredient: [
                            "2 garlic cloves, pressed or minced",
                        ],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "garlic",
                                    unit: "cloves",
                                    preparation: "pressed or minced",
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient unit without amount and strip 'of'",
                    input: {
                        recipeIngredient: ["Pinch of red pepper flakes"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "red pepper flakes",
                                    unit: "pinch",
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should strip 'of' after a leading unit",
                    input: { recipeIngredient: ["1 cup of flour"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "flour",
                                    unit: "cup",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should expand 'or' alternatives into a full name and variants",
                    input: {
                        recipeIngredient: [
                            "1 cup of brown or green lentils, picked over and rinsed",
                        ],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "brown or green lentils",
                                    variants: [
                                        "brown lentils",
                                        "green lentils",
                                    ],
                                    unit: "cup",
                                    preparation: "picked over and rinsed",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should expand 'or' alternatives and move size to description",
                    input: {
                        recipeIngredient: [
                            "1 medium yellow or white onion, chopped",
                        ],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "yellow or white onion",
                                    variants: ["yellow onion", "white onion"],
                                    description: "medium",
                                    preparation: "chopped",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should expand 'or' alternatives with a multi-word head",
                    input: {
                        recipeIngredient: ["2 red or green bell peppers"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "red or green bell peppers",
                                    variants: [
                                        "red bell peppers",
                                        "green bell peppers",
                                    ],
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should keep complete 'or' alternatives without a shared head",
                    input: { recipeIngredient: ["Butter or margarine"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "Butter or margarine",
                                    variants: ["Butter", "margarine"],
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should move a size descriptor to description",
                    input: { recipeIngredient: ["1 large egg"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "egg",
                                    description: "large",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should not treat postfix cloves as a unit when a leading unit exists",
                    input: { recipeIngredient: ["1 tsp ground cloves"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "ground cloves",
                                    unit: "tsp",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should collapse alternative names that differ only by size",
                    input: {
                        recipeIngredient: ["1 small or medium onion, chopped"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "onion",
                                    description: "small, medium",
                                    preparation: "chopped",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should not strip a size descriptor without a remaining name",
                    input: { recipeIngredient: ["1 medium"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "medium",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with notes (double bracket denoted)",
                    input: {
                        recipeIngredient: [
                            "1 oz tomato paste ((double strength, Italian))",
                        ],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "tomato paste",
                                    preparation: "double strength, Italian",
                                    unit: "oz",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with notes (comma denoted)",
                    input: {
                        recipeIngredient: ["2 lemon, 1 juiced, 1 sliced"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "lemon",
                                    preparation: "1 juiced, 1 sliced",
                                    amount: {
                                        representation: "number",
                                        value: "2",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should parse ingredient with amount after name",
                    input: {
                        recipeIngredient: ["Water, 150 g"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "Water",
                                    unit: "g",
                                    amount: {
                                        representation: "number",
                                        value: "150",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should handle empty ingredient list",
                    input: { recipeIngredient: [] },
                    expected: [],
                },
                {
                    name: "should handle HTML tags in ingredient names",
                    input: { recipeIngredient: ["1 cup <b>flour</b>"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "flour",
                                    unit: "cup",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should handle HTML entities in ingredient description",
                    input: {
                        recipeIngredient: ["1 apple (sliced &amp; peeled)"],
                    },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "apple",
                                    preparation: "sliced & peeled",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should handle ingredient with decimal amount that doesn't match common fractions",
                    input: { recipeIngredient: ["2.7 cups flour"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "flour",
                                    unit: "cups",
                                    amount: {
                                        representation: "number",
                                        value: "2.7",
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    name: "should handle ingredients with empty string parts",
                    input: { recipeIngredient: [""] },
                    expected: [],
                },
                {
                    name: "should parse ingredient with unknown unit",
                    input: { recipeIngredient: ["1 unknown_unit ingredient"] },
                    expected: [
                        {
                            name: "Ingredients",
                            items: [
                                {
                                    name: "unknown_unit ingredient",
                                    amount: {
                                        representation: "number",
                                        value: "1",
                                    },
                                },
                            ],
                        },
                    ],
                },
            ];

        runTestCases(testCases, ({ input, expected }) => {
            const result = convertRecipe({ ...baseRecipe, ...input });
            const ingredients = result.ingredients?.map((section) => ({
                ...section,
                items: section.items.map((item) =>
                    Object.fromEntries(
                        Object.entries(item).filter(([key]) => key !== "raw"),
                    ),
                ),
            }));

            expect(ingredients).toStrictEqual(expected);
        });

        it("should include the raw decoded ingredient line", () => {
            const result = convertRecipe({
                ...baseRecipe,
                recipeIngredient: [
                    "  4 garlic cloves, pressed or minced  ",
                    "1 cup <b>flour</b>",
                    "1 apple (sliced &amp; peeled)",
                ],
            });

            expect(
                result.ingredients?.[0]?.items.map((item) => item.raw),
            ).toStrictEqual([
                "4 garlic cloves, pressed or minced",
                "1 cup flour",
                "1 apple (sliced & peeled)",
            ]);
        });

        it("should limit the number of ingredient variants", () => {
            const modifiers = [
                "red",
                "green",
                "yellow",
                "orange",
                "purple",
                "black",
                "white",
                "brown",
                "pink",
                "blue",
                "gold",
            ];
            const result = convertRecipe({
                ...baseRecipe,
                recipeIngredient: [`1 ${modifiers.join(" or ")} peppers`],
            });

            expect(result.ingredients?.[0]?.items[0]?.variants).toHaveLength(
                MAX_INGREDIENT_VARIANTS,
            );
        });
    });

    describe("tag candidates", () => {
        const testCases: TestCase<
            NormalizedExtractedRecipe["tagCandidates"]
        >[] = [
            {
                name: "should extract cuisine candidates",
                input: { recipeCuisine: ["Italian"] },
                expected: { cuisine: ["italian"] },
            },
            {
                name: "should extract category candidates",
                input: { recipeCategory: ["Dinner"] },
                expected: { category: ["dinner"] },
            },
            {
                name: "should extract multiple candidate groups",
                input: { recipeCuisine: ["Indian"], recipeCategory: ["Lunch"] },
                expected: { cuisine: ["indian"], category: ["lunch"] },
            },
            {
                name: "should split and normalise keyword strings",
                input: { keywords: "Italian, Dinner" },
                expected: { keywords: ["italian", "dinner"] },
            },
            {
                name: "should deduplicate keyword arrays",
                input: { keywords: ["Italian", "italian", "Dinner"] },
                expected: { keywords: ["italian", "dinner"] },
            },
            {
                name: "should enforce the total tag candidate limit",
                input: {
                    keywords: Array.from(
                        { length: MAX_TAG_CANDIDATES + 1 },
                        (_, index) => `tag-${index}`,
                    ),
                },
                expected: undefined,
                throws: ExtractionLimitError,
            },
        ];

        runTestCases(testCases, ({ input, expected, throws }) => {
            if (throws) {
                expect(() =>
                    convertRecipe({ ...baseRecipe, ...input }),
                ).toThrow(throws);
                return;
            }

            const result = convertRecipe({ ...baseRecipe, ...input });

            expect(result.tagCandidates).toStrictEqual(expected);
        });
    });
});

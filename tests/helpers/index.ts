import { it } from "node:test";

type ThrowMatcher = string | RegExp | (new (...args: never[]) => Error);

export type TestCase<TExpected = unknown, TInput = object, TUpdate = object> = {
    name: string;
    input: TInput;
    update?: TUpdate;
    expected: TExpected;
    throws?: ThrowMatcher;
};

export const runTestCases = <TExpected, TInput, TUpdate = object>(
    testCases: TestCase<TExpected, TInput, TUpdate>[],
    testFn: (p: {
        input: TInput;
        update?: TUpdate;
        expected: TExpected;
        throws?: ThrowMatcher;
    }) => Promise<void> | void,
) =>
    testCases.forEach(({ name, ...rest }) => {
        it(name, () => testFn(rest));
    });

// Regression: Task Rail widget lines must never exceed the terminal width.
// pi's TuiMainScreen.doRender throws (killing the whole process) on any
// rendered line wider than the terminal. CJK text is double-width, so
// truncating by string length overflows. Crash observed 2026-09-08: a
// 172-char Result line rendered at 186 columns > 172-col terminal.

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	TASK_RAIL_KEY,
	type TaskRailView,
	presentTaskRail,
} from "../plugins/immune-brain/.pi-extension/pi-canary-interaction";

function captureWidget(view: TaskRailView): { render(width: number): string[] } {
	// setWidget receives a factory invoked as (tui, theme) on each render.
	const theme = {
		// ANSI-coded fg so truncation is exercised against styled lines.
		fg: (_name: string, text: string) => `\x1b[38;2;128;128;128m${text}\x1b[39m`,
		bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
	};
	let factory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
	const ctx = {
		ui: {
			setWidget(_key: string, widget: unknown) {
				factory = widget as typeof factory;
			},
			notify() {},
		},
	};
	presentTaskRail(ctx as never, view);
	const widget = factory?.(undefined, theme);
	if (!widget) throw new Error("widget factory did not produce a widget");
	return widget;
}

const CJK_RESULT =
	"冻结提交 1e13c0bf939302c23924f3fdfa43b1eed7e653e8 无法编译：" +
	"WelltoldCore/Sources/WelltoldPersistence/HealthDataStoreV2.swift:2080 和 :2122 " +
	"分别引用 V2PersistenceError.fullHistoryRecomputeMismatch 与 " +
	".fullHistoryIdentityCollision，但同一提交的 V2ValueModels.swift:435 所定义的枚举没有这两个成员。";

const CJK_VIEW: TaskRailView = {
	task_id: "retention-e2-aggregate-identity-rework",
	state: "Blocked",
	result: CJK_RESULT,
	next: "修复阻塞 findings，然后推进 assurance 验收",
	recovery: "修复阻塞 findings；保留无关的新鲜证据",
	phase: "验收中",
};

describe("task rail widget width safety", () => {
	test("CJK-heavy view renders every line within the terminal width", () => {
		const widget = captureWidget(CJK_VIEW);
		for (const width of [172, 120, 80, 40]) {
			const lines = widget.render(width);
			expect(lines.length).toBeGreaterThan(0);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			}
		}
	});

	test("crash case: 172-char CJK result no longer renders at 186 columns", () => {
		const widget = captureWidget(CJK_VIEW);
		const lines = widget.render(172);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(172);
		}
	});

	test("render error degrades to empty widget instead of crashing", () => {
		const broken = { ...CJK_VIEW, result: undefined as unknown as string };
		const widget = captureWidget(broken);
		const lines = widget.render(172);
		expect(Array.isArray(lines)).toBe(true);
		expect(lines).toEqual([]);
	});
});

describe("exports", () => {
	test("task rail key is stable", () => {
		expect(TASK_RAIL_KEY).toBe("immune-brain.task-rail");
	});
});

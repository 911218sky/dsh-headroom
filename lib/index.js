import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { freezeMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq } from "@deepseek-ai/dsh-session";
//#region src/format.ts
/** Convert a DSH summarization input to the OpenAI message shape. */
function toOpenAiMessages(input) {
	const messages = [];
	for (const message of input.messages) messages.push(...messageToOpenAi(message));
	return messages;
}
function messageToOpenAi(message) {
	if (message.role === "tool") return [{
		role: "tool",
		tool_call_id: message.toolCallId,
		content: blocksToText(message.content)
	}];
	if (message.role === "assistant") {
		const toolCalls = message.content.filter((block) => block.type === "tool-call");
		if (toolCalls.length > 0) return [{
			role: "assistant",
			content: blocksToText(message.content.filter((block) => block.type !== "tool-call")),
			tool_calls: toolCalls.map((block) => ({
				id: block.id,
				type: "function",
				function: {
					name: block.name,
					arguments: block.arguments
				}
			}))
		}];
	}
	return [{
		role: message.role,
		content: blocksToText(message.content)
	}];
}
function blocksToText(blocks) {
	return blocks.map(blockToText).filter((text) => text.length > 0).join("\n");
}
function blockToText(block) {
	switch (block.type) {
		case "text": return block.text;
		case "reasoning": return "";
		case "image": return "[image]";
		case "file": return "[file]";
		case "tool-call": return JSON.stringify({
			id: block.id,
			name: block.name,
			arguments: block.arguments
		});
		case "tool-addition":
		case "tool-removal": return "";
		default: return JSON.stringify(block);
	}
}
/** Render compressed wire messages as the checkpoint summary text. */
function renderCheckpointText(response) {
	const lines = response.messages.map((message) => renderWireMessage(message));
	const remaining = Math.round(response.compression_ratio * 100);
	const header = `[compressed by headroom: ${response.tokens_before} → ${response.tokens_after} tokens (${remaining}% of original)]`;
	const ccr = response.ccr_hashes.length > 0 ? `\nOriginal content is retrievable via the headroom_retrieve tool with one of these hashes: ${response.ccr_hashes.join(", ")}` : "";
	return `${header}\n\n${lines.join("\n\n")}${ccr}`;
}
function renderWireMessage(message) {
	const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? null);
	const call = message.tool_call_id === void 0 ? "" : ` (tool ${message.tool_call_id})`;
	return `[${message.role}${call}]\n${content}`;
}
//#endregion
//#region src/engine.ts
var HeadroomCompactionEngine = class extends BasicCompactionEngine {
	static inject = [
		"llm",
		"tokenMeter",
		"sessions"
	];
	headroomModel;
	compressMode;
	constructor(ctx, config = {}) {
		const { model, compressMode, ...base } = config;
		super(ctx, base);
		this.headroomModel = model;
		this.compressMode = compressMode ?? "ccr";
	}
	/**
	* Condense the replayed conversation region through the local proxy instead
	* of a paid LLM summarization call. The compressed message list is rendered
	* as text so the inherited checkpoint transaction can frame it.
	*/
	async summarize(input, agent, signal) {
		signal?.throwIfAborted();
		const client = this.ctx.headroomClient;
		if (client === void 0) throw new Error("dsh-headroom: headroom service is not ready; compaction deferred until the proxy responds");
		const model = this.headroomModel ?? routedModel(agent);
		const response = await client.compress(toOpenAiMessages(input), model, this.compressMode, signal);
		signal?.throwIfAborted();
		const text = renderCheckpointText(response);
		if (text.trim().length === 0) throw new Error("dsh-headroom: compression produced no output");
		return {
			summary: [{
				type: "text",
				text
			}],
			provider: "headroom",
			model: model ?? "headroom-proxy"
		};
	}
};
/** The conversation's routed model, when the session has one. */
function routedModel(agent) {
	const header = agent.session.requestHeader()?.config;
	if (header !== void 0 && header.model.length > 0) return header.model;
	if (agent.options.model !== void 0 && agent.options.model.length > 0) return agent.options.model;
}
//#endregion
//#region src/proxy-status.ts
function emptyProxyStatus(baseUrl = "") {
	return {
		phase: "starting",
		baseUrl,
		clientPresent: false,
		healthy: null,
		healthReason: null,
		httpStatus: null,
		lastError: null,
		updatedAt: Date.now()
	};
}
/** Classify a failed /health probe for logs and /headroom. */
function classifyHealthError(error, httpStatus) {
	if (httpStatus !== void 0) return {
		reason: "http_status",
		detail: `HTTP ${httpStatus}`
	};
	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();
	if (error instanceof DOMException && error.name === "TimeoutError") return {
		reason: "timeout",
		detail: message
	};
	if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("abort")) return {
		reason: "timeout",
		detail: message
	};
	if (lower.includes("econnrefused") || lower.includes("connection refused") || lower.includes("fetch failed")) return {
		reason: "refused",
		detail: message
	};
	if (lower.includes("network") || lower.includes("enotfound")) return {
		reason: "network",
		detail: message
	};
	return {
		reason: "unknown",
		detail: message
	};
}
/** Human-readable block for `/headroom` show. */
function renderProxyStatus(status) {
	const lines = [
		`Proxy status: ${status.phase}`,
		`baseUrl: ${status.baseUrl || "(unset)"}`,
		`clientPresent: ${status.clientPresent}`,
		`healthy: ${status.healthy === null ? "unknown" : String(status.healthy)}`
	];
	if (status.healthReason !== null) lines.push(`healthReason: ${status.healthReason}`);
	if (status.httpStatus !== null) lines.push(`httpStatus: ${status.httpStatus}`);
	if (status.lastError !== null && status.lastError.length > 0) lines.push(`lastError: ${status.lastError}`);
	lines.push(`updatedAt: ${new Date(status.updatedAt).toISOString()}`);
	return lines.join("\n");
}
//#endregion
//#region src/client.ts
/**
* Minimal HTTP client for the local Headroom compression proxy.
*
* The wire contract mirrors the official headroom-ai TypeScript SDK:
* `POST /v1/compress` compresses an OpenAI-style message list, `POST
* /v1/retrieve` restores original content from the CCR store, and `GET
* /health` reports service readiness.
*/
var HeadroomClient = class {
	baseUrl;
	timeoutMs;
	constructor(baseUrl, timeoutMs = 3e4) {
		this.baseUrl = baseUrl;
		this.timeoutMs = timeoutMs;
	}
	/** Whether the proxy answers /health successfully right now. */
	async health() {
		return (await this.probeHealth()).ok;
	}
	/** Probe /health with a classified reason for diagnostics. */
	async probeHealth() {
		try {
			const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2e3) });
			if (response.ok) return {
				ok: true,
				reason: "ok",
				httpStatus: response.status,
				detail: null
			};
			const classified = classifyHealthError(void 0, response.status);
			return {
				ok: false,
				reason: classified.reason,
				httpStatus: response.status,
				detail: classified.detail
			};
		} catch (error) {
			const classified = classifyHealthError(error);
			return {
				ok: false,
				reason: classified.reason,
				httpStatus: null,
				detail: classified.detail
			};
		}
	}
	/**
	* Compress an OpenAI-style message list through the local proxy. The proxy
	* requires the `model` field for token estimation; callers may pass the
	* conversation's routed model, and the harness default stands in when they
	* have none. `mode: 'ccr'` makes the proxy write CCR retrieval hashes for
	* lossy replacements, so `headroom_retrieve` can restore the originals.
	* @param signal - optional turn cancellation; combined with the request timeout.
	*/
	async compress(messages, model = "deepseek-chat", mode = "ccr", signal) {
		const body = {
			messages,
			model,
			config: { mode }
		};
		const response = await fetch(`${this.baseUrl}/v1/compress`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: requestSignal(this.timeoutMs, signal)
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`headroom /v1/compress failed: HTTP ${response.status} ${detail}`);
		}
		return await response.json();
	}
	/** Restore original content from the CCR store by its hash. */
	async retrieve(hash, signal) {
		const response = await fetch(`${this.baseUrl}/v1/retrieve`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ hash }),
			signal: requestSignal(this.timeoutMs, signal)
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(`headroom /v1/retrieve failed: HTTP ${response.status} ${detail}`);
		}
		return response.json();
	}
};
/** Timeout alone, or timeout raced with an external abort signal. */
function requestSignal(timeoutMs, signal) {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal === void 0 ? timeout : AbortSignal.any([timeout, signal]);
}
function resolveServiceConfig(config) {
	const port = config?.port ?? 8787;
	return {
		baseUrl: config?.baseUrl ?? `http://127.0.0.1:${port}`,
		port,
		command: config?.command,
		pythonPath: config?.pythonPath,
		uvCommand: config?.uvCommand,
		autoInstall: config?.autoInstall ?? true,
		installTimeoutMs: config?.installTimeoutMs ?? 6e5,
		startTimeoutMs: config?.startTimeoutMs ?? 6e4,
		savingsProfile: config?.savingsProfile,
		kompressMustKeep: config?.kompressMustKeep ?? true
	};
}
/**
* Resolve how to launch the proxy: an explicit `pythonPath` runs the headroom
* CLI module under that interpreter; otherwise the headroom executable is
* discovered.
*/
async function resolveLaunch(ctx, config) {
	if (config.pythonPath !== void 0 && config.pythonPath.length > 0) {
		const py = findExecutable(config.pythonPath);
		if (py !== void 0) {
			if (probeModule(py, [
				"-m",
				"headroom.cli",
				"--version"
			])) {
				ctx.logger.info("dsh-headroom: using python %s (-m headroom.cli)", py);
				return {
					command: py,
					prefix: ["-m", "headroom.cli"]
				};
			}
			if (probeModule(py, [
				"-m",
				"headroom",
				"--version"
			])) {
				ctx.logger.info("dsh-headroom: using python %s (-m headroom)", py);
				return {
					command: py,
					prefix: ["-m", "headroom"]
				};
			}
			ctx.logger.warn("dsh-headroom: pythonPath %s cannot run headroom as a module; falling back to command discovery", config.pythonPath);
		} else ctx.logger.warn("dsh-headroom: pythonPath %s not found; falling back to command discovery", config.pythonPath);
	}
	const command = findExecutable(config.command) ?? findOnPath("headroom") ?? uvToolBin("headroom");
	if (command !== void 0) return {
		command,
		prefix: []
	};
}
/** Probe one `python -m <module>` invocation; only a clean exit 0 means yes. */
function probeModule(py, args) {
	try {
		const probe = spawnSync(py, args, {
			stdio: "ignore",
			timeout: 5e3,
			shell: false
		});
		return probe.error === void 0 && probe.status === 0;
	} catch {
		return false;
	}
}
/**
* Bring the proxy up: reuse a healthy service, else discover or auto-install
* the command, spawn it, and wait for health. Never throws — failures degrade
* to a disabled compression backend with a logged reason.
*/
async function startHeadroomService(ctx, config) {
	const client = new HeadroomClient(config.baseUrl);
	const initialProbe = await client.probeHealth();
	if (initialProbe.ok) {
		ctx.logger.info("dsh-headroom: reusing headroom proxy at %s", config.baseUrl);
		return {
			client,
			dispose: () => {},
			reused: true,
			error: null
		};
	}
	ctx.logger.info("dsh-headroom: no healthy proxy at %s (%s); attempting launch", config.baseUrl, initialProbe.detail ?? initialProbe.reason);
	let launch = await resolveLaunch(ctx, config);
	if (launch === void 0 && config.autoInstall) {
		const py = config.pythonPath !== void 0 && config.pythonPath.length > 0 ? findExecutable(config.pythonPath) : void 0;
		if (py !== void 0) {
			ctx.logger.info("dsh-headroom: installing headroom-ai into %s via pip (first run)…", py);
			try {
				await runAndWait(py, [
					"-m",
					"pip",
					"install",
					"headroom-ai[all]"
				], config.installTimeoutMs);
			} catch (error) {
				ctx.logger.warn("dsh-headroom: pip auto-install failed: %s", errorMessage(error));
			}
			launch = await resolveLaunch(ctx, config);
		} else {
			const uv = findExecutable(config.uvCommand) ?? findOnPath("uv") ?? wingetUv();
			if (uv === void 0) {
				const error = "headroom not found and uv is not installed; install it with `uv tool install \"headroom-ai[all]\"` (install uv first if needed)";
				ctx.logger.warn("dsh-headroom: %s", error);
				return {
					client: void 0,
					dispose: () => {},
					reused: false,
					error
				};
			}
			ctx.logger.info("dsh-headroom: installing headroom-ai via uv (first run)…");
			try {
				await runAndWait(uv, [
					"tool",
					"install",
					"--python",
					"3.13",
					"headroom-ai[all]"
				], config.installTimeoutMs);
			} catch (error) {
				const detail = `auto-install failed: ${errorMessage(error)}`;
				ctx.logger.warn("dsh-headroom: %s", detail);
				return {
					client: void 0,
					dispose: () => {},
					reused: false,
					error: detail
				};
			}
			launch = await resolveLaunch(ctx, config);
		}
	}
	if (launch === void 0) {
		const error = "headroom command not found; compression disabled. Install it with `uv tool install \"headroom-ai[all]\"`, set config.headroom.command, or set config.headroom.pythonPath to a Python that has headroom-ai installed.";
		ctx.logger.warn("dsh-headroom: %s", error);
		return {
			client: void 0,
			dispose: () => {},
			reused: false,
			error
		};
	}
	const child = spawn(launch.command, [
		...launch.prefix,
		"proxy",
		"--port",
		String(config.port)
	], {
		stdio: "ignore",
		windowsHide: true,
		env: {
			...process.env,
			...config.savingsProfile === void 0 ? {} : { HEADROOM_SAVINGS_PROFILE: config.savingsProfile },
			...config.kompressMustKeep ? {} : { HEADROOM_KOMPRESS_MUST_KEEP: "0" }
		}
	});
	child.on("error", (error) => ctx.logger.warn("dsh-headroom: proxy failed to start: %s", errorMessage(error)));
	child.on("exit", (code) => ctx.logger.warn("dsh-headroom: proxy exited early with code %s", String(code)));
	const deadline = Date.now() + config.startTimeoutMs;
	while (Date.now() < deadline) {
		if ((await client.probeHealth()).ok) {
			ctx.logger.info("dsh-headroom: proxy ready at %s", config.baseUrl);
			return {
				client,
				dispose: () => killProcessTree(child),
				reused: false,
				error: null
			};
		}
		await sleep(500);
	}
	const error = `proxy did not become healthy within ${config.startTimeoutMs}ms; compression disabled`;
	ctx.logger.warn("dsh-headroom: %s", error);
	killProcessTree(child);
	return {
		client: void 0,
		dispose: () => {},
		reused: false,
		error
	};
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Resolve one explicit executable candidate; a leading `~` expands to the home directory. */
function findExecutable(candidate) {
	if (candidate === void 0 || candidate.length === 0) return void 0;
	const expanded = candidate === "~" || candidate.startsWith("~/") || candidate.startsWith("~\\") ? join(homedir(), candidate.slice(1)) : candidate;
	if (existsSync(expanded)) return expanded;
	if (process.platform === "win32" && existsSync(`${expanded}.exe`)) return `${expanded}.exe`;
}
/** Resolve a bare command name through the process PATH. */
function findOnPath(name) {
	const probe = spawnSync(name, ["--version"], {
		stdio: "ignore",
		timeout: 3e3,
		shell: false
	});
	return probe.error === void 0 && probe.status !== null ? name : void 0;
}
/** uv tool installs land in ~/.local/bin by default. */
function uvToolBin(name) {
	const binDir = process.env.UV_TOOL_BIN_DIR;
	const base = binDir !== void 0 && binDir.length > 0 ? binDir : join(homedir(), ".local", "bin");
	return findExecutable(join(base, name));
}
/** Locate a winget-installed uv (the astral-sh.uv package layout). */
function wingetUv() {
	if (process.platform !== "win32") return void 0;
	const packagesDir = join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
	if (!existsSync(packagesDir)) return void 0;
	for (const entry of readdirSync(packagesDir)) {
		if (!entry.startsWith("astral-sh.uv")) continue;
		const candidate = join(packagesDir, entry, "uv.exe");
		if (existsSync(candidate)) return candidate;
	}
}
/** Run one command to completion, rejecting on non-zero exit or timeout. */
function runAndWait(command, args, timeoutMs) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: [
				"ignore",
				"ignore",
				"pipe"
			],
			windowsHide: true
		});
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(/* @__PURE__ */ new Error(`${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(/* @__PURE__ */ new Error(`${command} exited with ${String(code)}: ${stderr.slice(-2e3)}`));
		});
	});
}
/** Terminate the child and (on Windows) its process tree. */
function killProcessTree(child) {
	if (child.pid === void 0) return;
	if (process.platform === "win32") try {
		spawnSync("taskkill", [
			"/pid",
			String(child.pid),
			"/T",
			"/F"
		], { stdio: "ignore" });
	} catch {}
	child.kill();
}
//#endregion
//#region src/result-compressor.ts
/** Prefix marking a headroom-compressed tool result; scanners skip these. */
const COMPRESSED_RESULT_PREFIX = "[compressed by headroom";
/** Default tool-result compression policy. */
const RESULT_COMPRESSION_DEFAULTS = {
	enabled: true,
	thresholdChars: 8192,
	minSavingsRatio: .15,
	maxPerStep: 3,
	compressMode: "ccr"
};
/** Merge partial configuration over the defaults. */
function resolveResultCompression(config) {
	return {
		enabled: config?.enabled ?? RESULT_COMPRESSION_DEFAULTS.enabled,
		thresholdChars: config?.thresholdChars ?? RESULT_COMPRESSION_DEFAULTS.thresholdChars,
		minSavingsRatio: config?.minSavingsRatio ?? RESULT_COMPRESSION_DEFAULTS.minSavingsRatio,
		maxPerStep: config?.maxPerStep ?? RESULT_COMPRESSION_DEFAULTS.maxPerStep,
		compressMode: config?.compressMode ?? RESULT_COMPRESSION_DEFAULTS.compressMode
	};
}
/** Text length in Unicode code points; non-text blocks cost zero. */
function measureText(blocks) {
	let chars = 0;
	for (const block of blocks) if (block.type === "text") chars += Array.from(block.text).length;
	return chars;
}
/** Whether content carries the headroom compression marker on its first block. */
function isCompressedResult(blocks) {
	const first = blocks[0];
	return first?.type === "text" && first.text.startsWith("[compressed by headroom");
}
/**
* Collect over-budget, uncompressed tool-result surface nodes in surface
* order. Nodes below the threshold or already carrying the compression
* marker are skipped, so a pass never re-compresses its own output.
* @param session - session whose current surface is scanned.
* @param thresholdChars - minimum text length (code points) that qualifies.
* @returns candidate surface nodes in surface order.
*/
function scanResultCandidates(session, thresholdChars) {
	const candidates = [];
	for (const seq of [...session.surface.nodes]) {
		const event = session.eventAt(SessionSeq(seq));
		if (event?.type !== "tool/result") continue;
		const content = event.data.message.content;
		if (isCompressedResult(content)) continue;
		if (measureText(content) < thresholdChars) continue;
		candidates.push({
			seq,
			event
		});
	}
	return candidates;
}
/**
* Whether a compression is worth replacing the original: the proxy must
* report enough token savings to justify losing the verbatim text.
* @param tokensBefore - proxy-reported token count of the original.
* @param tokensAfter - proxy-reported token count of the compressed result.
* @param minSavingsRatio - required minimum saved fraction (0..1).
* @returns true when the replacement is strictly smaller than the budget.
*/
function shouldReplace(tokensBefore, tokensAfter, minSavingsRatio) {
	if (tokensBefore <= 0) return false;
	return tokensAfter < tokensBefore * (1 - minSavingsRatio);
}
/**
* Render the compressed tool-result text: a retrieval header carrying the
* token accounting and the CCR hashes, then the compressed content.
* @param text - compressed tool-result text from the proxy.
* @param tokensBefore - proxy-reported token count of the original.
* @param tokensAfter - proxy-reported token count of the compressed result.
* @param ccrHashes - CCR store hashes; original content is retrievable with them.
* @returns the replacement text block content.
*/
function renderCompressedResult(text, tokensBefore, tokensAfter, ccrHashes) {
	const remaining = tokensBefore > 0 ? Math.round(tokensAfter / tokensBefore * 100) : 0;
	const ccr = ccrHashes.length > 0 ? ` Original retrievable via the headroom_retrieve tool with one of these hashes: ${ccrHashes.join(", ")}.` : "";
	return `${COMPRESSED_RESULT_PREFIX}: ${tokensBefore} → ${tokensAfter} tokens (${remaining}% of original).${ccr}]\n${text}`;
}
/** Extract the compressed text from a proxy compress response. */
function compressedText(response) {
	const message = response.messages[0];
	if (typeof message !== "object" || message === null) return void 0;
	const content = message.content;
	return typeof content === "string" && content.length > 0 ? content : void 0;
}
/**
* Compress the over-budget tool results of one session through the proxy,
* replacing each qualified node with a headroom-compressed text block via the
* shared shadow-price protocol. Skips nodes the proxy cannot compress or that
* fail the savings test; earlier replacements stay durable when a later one
* fails.
* @param ctx - context providing the token meter for shadow pricing.
* @param client - healthy headroom proxy client.
* @param agent - agent owning the session; its routed model reports to the proxy.
* @param session - session whose current surface is rewritten.
* @param config - resolved tool-result compression policy.
* @param attempted - seqs that reached a terminal no-replace outcome (empty
* text, unusable proxy output, or insufficient savings). The pass skips them
* so low-yield candidates cannot starve the budget. Transient proxy failures
* must not be recorded here so a later step can retry.
* @param signal - cancellation; a pass aborts between candidates and cancels
* in-flight compress requests.
* @returns landed replacements with token accounting.
*/
async function compressSessionResults(ctx, client, agent, session, config, attempted, signal) {
	const candidates = scanResultCandidates(session, config.thresholdChars).filter((candidate) => !attempted.has(candidate.seq)).slice(0, config.maxPerStep);
	const outcomes = [];
	for (const { seq, event } of candidates) {
		signal?.throwIfAborted();
		const message = event.data.message;
		const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		if (text.length === 0) {
			attempted.add(seq);
			continue;
		}
		const model = routedModel(agent) ?? "deepseek-chat";
		const response = await client.compress([{
			role: "tool",
			tool_call_id: message.toolCallId,
			content: text
		}], model, config.compressMode, signal);
		signal?.throwIfAborted();
		const compressed = compressedText(response);
		if (compressed === void 0) {
			attempted.add(seq);
			continue;
		}
		if (!shouldReplace(response.tokens_before, response.tokens_after, config.minSavingsRatio)) {
			attempted.add(seq);
			continue;
		}
		const replaced = renderCompressedResult(compressed, response.tokens_before, response.tokens_after, response.ccr_hashes);
		const replacement = freezeMessage({
			...message,
			content: [{
				type: "text",
				text: replaced
			}]
		});
		const seqBrand = SessionSeq(seq);
		session.append("compaction/prune", {
			shadowedRange: {
				start: seqBrand,
				end: seqBrand
			},
			shadowedSeqs: [seqBrand],
			shadowedTokenCount: ctx.tokenMeter.estimateMessage(message)
		});
		const replacementEvent = session.append("tool/result", {
			...event.data,
			message: replacement
		}, {
			surfaceOp: {
				op: "replace",
				startSeq: seqBrand,
				endSeq: seqBrand
			},
			sourceEventSeqs: [seqBrand]
		});
		outcomes.push({
			seq,
			replacementSeq: replacementEvent.seq,
			tokensBefore: response.tokens_before,
			tokensAfter: response.tokens_after
		});
	}
	return outcomes;
}
/**
* Install the per-step tool-result compression listener. Runs before the
* historical compaction pass so the surface it prices is already slimmed.
* Skips silently when the proxy is unavailable or the live config disables
* compression; a failed pass degrades to the original content.
* @param ctx - plugin context.
* @param resolveConfig - live policy resolver, read at every step boundary so
* settings changes apply without a restart.
*/
function installResultCompression(ctx, resolveConfig) {
	const attempted = /* @__PURE__ */ new WeakMap();
	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		const config = resolveConfig();
		const client = ctx.headroomClient;
		if (config.enabled && client !== void 0 && !signal.aborted) try {
			let tried = attempted.get(agent.session);
			if (tried === void 0) {
				tried = /* @__PURE__ */ new Set();
				attempted.set(agent.session, tried);
			}
			const outcomes = await compressSessionResults(ctx, client, agent, agent.session, config, tried, signal);
			if (outcomes.length > 0) {
				const before = outcomes.reduce((sum, outcome) => sum + outcome.tokensBefore, 0);
				const after = outcomes.reduce((sum, outcome) => sum + outcome.tokensAfter, 0);
				ctx.logger.info("dsh-headroom: compressed %d tool result(s) (%d → %d tokens)", outcomes.length, before, after);
			}
		} catch (error) {
			ctx.logger.warn("dsh-headroom: tool-result compression failed: %s", message$1(error));
		}
		return next();
	});
}
function message$1(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/command.ts
const USAGE = "Usage: /headroom (no args) | /headroom set <key> <value> | /headroom unset <key>";
/** Settings keys the command accepts, mapped to their value kinds. */
const KEY_KINDS = {
	port: "number",
	baseUrl: "string",
	command: "string",
	pythonPath: "string",
	uvCommand: "string",
	autoInstall: "boolean",
	resultCompressionEnabled: "boolean",
	resultCompressionThresholdChars: "number"
};
/**
* Parse a `/headroom` raw input into a command request.
* @param raw - the invocation's raw input (arguments only).
* @returns the parsed request.
*/
function parseHeadroomCommand(raw) {
	const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0);
	if (tokens.length === 0) return { kind: "show" };
	const first = tokens[0];
	const key = tokens[1];
	if (first === "unset" && tokens.length === 2 && key !== void 0 && key in KEY_KINDS) return {
		kind: "unset",
		key
	};
	if (first === "set" && tokens.length >= 3 && key !== void 0 && key in KEY_KINDS) {
		const value = parseValue(key, tokens.slice(2).join(" "));
		if (value !== void 0) return {
			kind: "set",
			key,
			value
		};
	}
	return { kind: "show" };
}
/** Parse one value string by the key's kind; `undefined` on malformed input. */
function parseValue(key, text) {
	const kind = KEY_KINDS[key];
	if (kind === "number") {
		const parsed = Number(text);
		if (!Number.isFinite(parsed)) return void 0;
		if (key === "port" && (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)) return void 0;
		if (key === "resultCompressionThresholdChars" && (!Number.isInteger(parsed) || parsed < 1)) return void 0;
		return parsed;
	}
	if (kind === "boolean") {
		if (text === "true") return true;
		if (text === "false") return false;
		return;
	}
	return text;
}
/** Render the current resolved settings as the command's success text. */
function renderSettings(settings) {
	return JSON.stringify(settings, null, 2);
}
/** Build the show payload: settings JSON plus live proxy diagnostics. */
async function renderHeadroomShow(ctx, settings) {
	const stored = ctx.headroomProxyStatus;
	const client = ctx.headroomClient;
	const baseUrl = stored?.baseUrl || settings.baseUrl || (settings.port !== void 0 ? `http://127.0.0.1:${settings.port}` : "");
	let status = stored ?? {
		phase: client !== void 0 ? "ready" : "down",
		baseUrl,
		clientPresent: client !== void 0,
		healthy: null,
		healthReason: null,
		httpStatus: null,
		lastError: null,
		updatedAt: Date.now()
	};
	if (client !== void 0) {
		const probe = await client.probeHealth();
		status = {
			...status,
			baseUrl: client.baseUrl,
			clientPresent: true,
			healthy: probe.ok,
			healthReason: probe.reason,
			httpStatus: probe.httpStatus,
			phase: probe.ok ? "ready" : "down",
			lastError: probe.ok ? status.lastError : probe.detail ?? status.lastError,
			updatedAt: Date.now()
		};
	} else status = {
		...status,
		clientPresent: false,
		healthy: false,
		phase: status.phase === "starting" ? "starting" : "down",
		updatedAt: Date.now()
	};
	return [
		renderProxyStatus(status),
		"",
		"Current settings:",
		renderSettings(settings),
		"",
		"Tip: if the settings card is missing, the host WEB_SETTINGS_NAMESPACES allowlist may omit dsh-headroom — /headroom always works."
	].join("\n");
}
/** Execute one parsed command against the settings service and scope. */
async function executeHeadroomCommand(ctx, scope, _ns, command) {
	try {
		if (command.kind === "show") return {
			kind: "success",
			text: await renderHeadroomShow(ctx, scope.get())
		};
		if (command.kind === "unset") {
			await scope.unset(command.key);
			return {
				kind: "success",
				text: `Cleared ${command.key}; the composition default applies.`
			};
		}
		await scope.update({ [command.key]: command.value });
		return {
			kind: "success",
			text: `Set ${command.key} = ${JSON.stringify(command.value)}.`
		};
	} catch (error) {
		return {
			kind: "error",
			text: `Failed to update settings: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}
/**
* Register the `/headroom` command.
* @param ctx - context carrying the command registry and settings service.
* @param scope - the plugin's settings scope, written host-side.
* @param ns - the plugin's settings namespace.
*/
function installHeadroomCommand(ctx, scope, ns) {
	ctx.effect(() => ctx.commands.register({
		name: "headroom",
		description: "View or change Headroom compression settings",
		handler: (invocation) => {
			const command = parseHeadroomCommand(invocation.rawInput);
			if (command.kind === "show" && invocation.rawInput.trim().length > 0) return Promise.resolve({
				kind: "error",
				text: USAGE
			});
			return executeHeadroomCommand(ctx, scope, ns, command);
		}
	}), "dsh-headroom: command");
}
//#endregion
//#region src/proxy-lifecycle.ts
/** Testable core of installProxyLifecycle. */
function createProxyLifecycle(hooks) {
	let current;
	let generation = 0;
	let queue = Promise.resolve();
	let lastLaunchKey = "";
	const restart = () => {
		queue = queue.then(async () => {
			const id = ++generation;
			const baseUrl = hooks.getBaseUrl();
			hooks.setStatus({
				...emptyProxyStatus(baseUrl),
				phase: "starting",
				updatedAt: Date.now()
			});
			const launchKey = hooks.getLaunchKey();
			if (launchKey !== lastLaunchKey && current !== void 0) {
				current.dispose();
				current = void 0;
			}
			lastLaunchKey = launchKey;
			const started = await hooks.start();
			if (id !== generation) {
				started.dispose();
				return;
			}
			if (started.client !== void 0) hooks.prewarm?.(started.client);
			if (started.reused) {
				hooks.setClient(started.client);
				hooks.setStatus({
					phase: started.client !== void 0 ? "ready" : "down",
					baseUrl,
					clientPresent: started.client !== void 0,
					healthy: started.client !== void 0,
					healthReason: started.client !== void 0 ? "ok" : null,
					httpStatus: started.client !== void 0 ? 200 : null,
					lastError: started.error,
					updatedAt: Date.now()
				});
				return;
			}
			current?.dispose();
			hooks.setClient(started.client);
			current = { dispose: started.dispose };
			hooks.setStatus({
				phase: started.client !== void 0 ? "ready" : "down",
				baseUrl,
				clientPresent: started.client !== void 0,
				healthy: started.client !== void 0,
				healthReason: started.client !== void 0 ? "ok" : null,
				httpStatus: started.client !== void 0 ? 200 : null,
				lastError: started.error,
				updatedAt: Date.now()
			});
		}).catch((error) => {
			hooks.onRestartError(error);
			hooks.setClient(void 0);
			hooks.setStatus({
				...emptyProxyStatus(hooks.getBaseUrl()),
				phase: "down",
				clientPresent: false,
				healthy: false,
				lastError: error instanceof Error ? error.message : String(error),
				updatedAt: Date.now()
			});
		});
	};
	return {
		restart,
		dispose: () => {
			generation += 1;
			current?.dispose();
			current = void 0;
			hooks.setClient(void 0);
			hooks.setStatus({
				...emptyProxyStatus(hooks.getBaseUrl()),
				phase: "down",
				lastError: "plugin unloaded",
				updatedAt: Date.now()
			});
		},
		idle: () => queue.then(() => void 0)
	};
}
//#endregion
//#region src/settings-scope.ts
/** Profile entry id — SettingsForms namespace on 0.2 hosts. */
const HEADROOM_ENTRY_ID = "dsh-headroom";
/** Settings namespace branded for command / describe lookups. */
const HEADROOM_SETTINGS_NS = HEADROOM_ENTRY_ID;
/** Path from a flat HeadroomSettings key to the nested Config document. */
function pathFor(key) {
	switch (key) {
		case "resultCompressionEnabled": return ["resultCompression", "enabled"];
		case "resultCompressionThresholdChars": return ["resultCompression", "thresholdChars"];
		case "command":
		case "pythonPath":
		case "uvCommand":
		case "port":
		case "baseUrl":
		case "autoInstall": return ["headroom", key];
		default: return [key];
	}
}
/** Flatten composition or describe() Config into HeadroomSettings. */
function flattenHeadroomSettings(source) {
	const headroom = source?.headroom;
	const result = source?.resultCompression;
	return {
		command: headroom?.command,
		pythonPath: headroom?.pythonPath,
		uvCommand: headroom?.uvCommand,
		port: headroom?.port ?? 8787,
		baseUrl: headroom?.baseUrl,
		autoInstall: headroom?.autoInstall ?? true,
		resultCompressionEnabled: result?.enabled,
		resultCompressionThresholdChars: result?.thresholdChars
	};
}
function settingsOf(ctx) {
	return ctx.settings;
}
function readLiveConfig(ctx, fallback) {
	const descriptor = settingsOf(ctx)?.describe?.().find((entry) => entry.ns === HEADROOM_ENTRY_ID);
	if (descriptor?.value !== void 0 && typeof descriptor.value === "object" && descriptor.value !== null) return descriptor.value;
	return fallback;
}
/**
* Enable auto-generated settings UI when SettingsForms.configure exists.
*/
function installHeadroomSettingsPresentation(ctx) {
	const settings = settingsOf(ctx);
	if (typeof settings?.configure !== "function") return;
	ctx.effect(() => settings.configure({ auto: true }, ctx.fiber), "dsh-headroom: settings presentation");
}
/**
* Build a live scope over the `dsh-headroom` profile entry.
* Falls back to composition `config` when describe is unavailable.
*/
function createHeadroomLiveScope(ctx, config) {
	const get = () => flattenHeadroomSettings(readLiveConfig(ctx, config));
	const watch = (listener) => {
		const events = ctx;
		if (typeof events.on !== "function") return () => void 0;
		return events.on("settings/document-updated", (ns) => {
			if (String(ns) === "dsh-headroom") listener();
		});
	};
	const mutate = async (ops) => {
		const settings = settingsOf(ctx);
		if (typeof settings?.mutate === "function") {
			const descriptor = settings.describe?.().find((entry) => entry.ns === HEADROOM_ENTRY_ID);
			await settings.mutate(HEADROOM_ENTRY_ID, ops, descriptor?.revision);
			return;
		}
		if (typeof settings?.update === "function") {
			const patch = {};
			for (const op of ops) {
				if (op.op !== "set") continue;
				if (op.path.length === 1) patch[op.path[0]] = op.value;
				else if (op.path[0] === "headroom") {
					const headroom = patch.headroom ?? {};
					headroom[op.path[1]] = op.value;
					patch.headroom = headroom;
				} else if (op.path[0] === "resultCompression") {
					const result = patch.resultCompression ?? {};
					result[op.path[1]] = op.value;
					patch.resultCompression = result;
				}
			}
			await settings.update(HEADROOM_ENTRY_ID, patch);
		}
	};
	return {
		get,
		watch,
		async update(patch) {
			const ops = Object.entries(patch).map(([key, value]) => ({
				op: "set",
				path: pathFor(key),
				value
			}));
			if (ops.length === 0) return;
			await mutate(ops);
		},
		async unset(key) {
			await mutate([{
				op: "unset",
				path: pathFor(key)
			}]);
		}
	};
}
//#endregion
//#region src/index.ts
const name = "dsh-headroom";
/** Services the plugin and its compaction engine read through the context. */
const inject = [
	"settings",
	"tools",
	"llm",
	"tokenMeter",
	"sessions",
	"commands"
];
const serviceConfigSchema = z.object({
	baseUrl: z.string(),
	port: z.number().step(1).min(1).max(65535),
	command: z.string(),
	pythonPath: z.string(),
	uvCommand: z.string(),
	autoInstall: z.boolean(),
	installTimeoutMs: z.number().step(1).min(1e3),
	startTimeoutMs: z.number().step(1).min(1e3),
	savingsProfile: z.string(),
	kompressMustKeep: z.boolean()
});
const Config = z.object({
	headroom: serviceConfigSchema,
	model: z.string(),
	thresholdRatio: z.number(),
	retainRatio: z.number(),
	retainTokens: z.number().step(1).min(0),
	compactionRetries: z.number().step(1).min(0),
	maxOverflowRetries: z.number().step(1).min(0),
	auto: z.boolean(),
	resultCompression: z.object({
		enabled: z.boolean(),
		thresholdChars: z.number().step(1).min(1),
		minSavingsRatio: z.number(),
		maxPerStep: z.number().step(1).min(1)
	}),
	compressMode: z.union([z.const("ccr"), z.const("default")]),
	prewarm: z.boolean()
});
/** Every key BasicCompactionEngine's config validation accepts. */
const BASIC_CONFIG_KEYS = [
	"thresholdRatio",
	"retainRatio",
	"retainTokens",
	"summarizationProvider",
	"summarizationModel",
	"maxTokens",
	"compactionRetries",
	"maxOverflowRetries",
	"modelPolicies",
	"auto"
];
function engineConfig(config) {
	const engine = {};
	if (config.model !== void 0) engine.model = config.model;
	if (config.compressMode !== void 0) engine.compressMode = config.compressMode;
	for (const key of BASIC_CONFIG_KEYS) {
		const value = config[key];
		if (value !== void 0) engine[key] = value;
	}
	return engine;
}
function apply(ctx, config) {
	ctx.provide("headroomClient", void 0);
	ctx.provide("headroomProxyStatus", emptyProxyStatus());
	installHeadroomSettingsPresentation(ctx);
	const scope = createHeadroomLiveScope(ctx, config);
	installProxyLifecycle(ctx, scope, config);
	installResultCompression(ctx, () => liveResultConfig(scope, config));
	installEngine(ctx, config);
	installTakeoverRollback(ctx);
	installHeadroomCommand(ctx, scope, HEADROOM_SETTINGS_NS);
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "headroom_retrieve",
		description: "Restore original content that the Headroom compression proxy replaced with a compacted checkpoint. Pass the exact ccr hash listed in a <compacted-summary> block of the conversation; returns the original tool output or message text.",
		parameters: { hash: {
			type: "string",
			description: "CCR hash shown in the compacted checkpoint."
		} },
		output: {
			schema: { type: "json" },
			render(_args, value) {
				return [{
					type: "text",
					text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
				}];
			}
		},
		async execute(args) {
			const client = ctx.headroomClient;
			if (client === void 0) throw new Error("headroom service is not ready: no proxy is reachable");
			return await client.retrieve(args.hash);
		}
	})), "dsh-headroom: tool");
}
/**
* Result-compression policy resolved at a step boundary: settings values
* override the composition layer, which itself defaults over the baked-in
* policy defaults.
*/
function liveResultConfig(scope, config) {
	const base = resolveResultCompression({
		...config.resultCompression,
		compressMode: config.compressMode ?? config.resultCompression?.compressMode
	});
	const settings = scope.get();
	return {
		...base,
		enabled: settings.resultCompressionEnabled ?? base.enabled,
		thresholdChars: settings.resultCompressionThresholdChars ?? base.thresholdChars
	};
}
/**
* Run the proxy lifecycle off the live settings document: start once, restart on
* every settings change, and dispose on plugin unload. Restarts are serialized
* so an older spawn can never be killed by the newer restart that reused it,
* and proxy ownership follows the restart that actually spawned it.
*/
function installProxyLifecycle(ctx, scope, config) {
	ctx.effect(() => {
		const setStatus = (status) => {
			ctx.reflect.set("headroomProxyStatus", status);
		};
		const lifecycle = createProxyLifecycle({
			getBaseUrl: () => {
				const settings = scope.get();
				return resolveServiceConfig({
					...config.headroom,
					command: settings.command || void 0,
					pythonPath: settings.pythonPath || void 0,
					uvCommand: settings.uvCommand || void 0,
					port: settings.port,
					baseUrl: settings.baseUrl || void 0,
					autoInstall: settings.autoInstall
				}).baseUrl;
			},
			getLaunchKey: () => {
				const settings = scope.get();
				return JSON.stringify({
					command: settings.command ?? null,
					pythonPath: settings.pythonPath ?? null,
					uvCommand: settings.uvCommand ?? null,
					port: settings.port ?? null,
					baseUrl: settings.baseUrl ?? null,
					autoInstall: settings.autoInstall ?? null
				});
			},
			start: async () => {
				const settings = scope.get();
				return startHeadroomService(ctx, resolveServiceConfig({
					...config.headroom,
					command: settings.command || void 0,
					pythonPath: settings.pythonPath || void 0,
					uvCommand: settings.uvCommand || void 0,
					port: settings.port,
					baseUrl: settings.baseUrl || void 0,
					autoInstall: settings.autoInstall
				}));
			},
			setClient: (client) => {
				ctx.reflect.set("headroomClient", client);
			},
			setStatus,
			onRestartError: (error) => {
				ctx.logger.warn("dsh-headroom: proxy restart failed: %s", message(error));
			},
			prewarm: (client) => {
				if (config.prewarm === false) return;
				client.compress([{
					role: "user",
					content: "headroom prewarm"
				}], "deepseek-chat", "default").catch(() => void 0);
			}
		});
		lifecycle.restart();
		const stopWatch = scope.watch(() => lifecycle.restart());
		return () => {
			stopWatch();
			lifecycle.dispose();
		};
	}, "dsh-headroom: proxy lifecycle");
}
/** BasicCompactionEngine's default retention ratio, mirrored for load-time validation. */
const DEFAULT_RETAIN_RATIO = .16;
/**
* Validate the effective compaction policy the headroom engine would resolve,
* mirroring BasicCompactionConfig's load-time checks (`resolveConfig` is not
* exported from the compaction-basic package). The point is not to duplicate
* the harness policy engine but to catch a rejected config BEFORE any Service
* registration, so a bad policy cannot leave a half-initialized `compaction`
* service behind.
* @param config - the engine config passed to {@link HeadroomCompactionEngine}.
* @throws the same style of `BasicCompactionConfig: ...` errors the engine
* constructor would throw, on any load-time-invalid policy.
*/
function assertValidEngineConfig(config) {
	const ratio = (name, value) => {
		if (value < 0 || value > 1) throw new Error(`BasicCompactionConfig: ${name} (${value}) must be between 0 and 1`);
	};
	const numberOrThrow = (name, value) => {
		if (value === void 0) return void 0;
		if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`BasicCompactionConfig: ${name} must be a finite number`);
		return value;
	};
	const thresholdRatio = numberOrThrow("thresholdRatio", config.thresholdRatio) ?? .8;
	ratio("thresholdRatio", thresholdRatio);
	const retainRatio = numberOrThrow("retainRatio", config.retainRatio);
	const retainTokens = numberOrThrow("retainTokens", config.retainTokens);
	if (retainRatio !== void 0) ratio("retainRatio", retainRatio);
	if (retainRatio !== void 0 && retainTokens !== void 0) throw new Error("BasicCompactionConfig: retainRatio and retainTokens are mutually exclusive");
	const resolvedRetainRatio = retainRatio ?? (retainTokens === void 0 ? DEFAULT_RETAIN_RATIO : void 0);
	if (resolvedRetainRatio !== void 0 && resolvedRetainRatio >= thresholdRatio) throw new Error(`BasicCompactionConfig: retainRatio (${resolvedRetainRatio}) must be less than the resolved thresholdRatio (${thresholdRatio})`);
}
/**
* Register the headroom compaction engine as `ctx.compaction`. The Service
* constructor provides the name immediately, so a duplicate-registration
* conflict with the default compaction-basic backend surfaces synchronously;
* in that case the loader entry of compaction-basic is disabled at runtime
* and the headroom engine takes over. The takeover is rolled back when this
* plugin unloads (see {@link installTakeoverRollback}).
*/
function installEngine(ctx, config) {
	try {
		assertValidEngineConfig(engineConfig(config));
	} catch (error) {
		ctx.logger.warn("dsh-headroom: invalid compaction config, keeping the default backend: %s", message(error));
		return;
	}
	try {
		new HeadroomCompactionEngine(ctx, engineConfig(config));
		ctx.logger.info("dsh-headroom: compaction engine registered (backend=headroom)");
	} catch (error) {
		if (!serviceConflict(error)) {
			ctx.logger.warn("dsh-headroom: compaction engine registration failed: %s", message(error));
			return;
		}
		takeOverCompaction(ctx, config);
	}
}
/** Whether this plugin disabled compaction-basic loader entries at runtime. */
let compactionTakenOver = false;
/** Original disabled flags of the entries this plugin disabled, for rollback. */
let compactionRestore = [];
function loaderOf(ctx) {
	return ctx.loader;
}
/**
* Whether a loader entry names the `compaction-basic` row. The effective id
* carries the owning subtree's prefix (`include:compaction-basic` under the
* file-backed include tree), so the bare id alone never matches; the suffix
* keeps the match robust to any prefixing layer while staying blind to ids
* that merely end in the same name from a different namespace.
*/
function isCompactionEntry(entry) {
	return entry.id === "compaction-basic" || entry.id.endsWith(":compaction-basic");
}
/**
* Set every `compaction-basic` entry's disabled flag across the loader tree.
* Patch and preset layers can each carry an entry under the same id, and a
* bare `loader.update(id, ...)` only touches the first match in the current
* tree, so the takeover walks `entries()` instead. When the loader offers no
* `entries()` view, falls back to the tree-level update. Returns each touched
* entry's previous `disabled` value so the caller can restore them on unload.
* @param loader - the loader service surface.
* @param disabled - the disabled flag to write onto every match.
* @returns per-entry restore records (id plus the previous disabled value).
*/
async function setCompactionEntries(loader, disabled) {
	const targets = [...loader.entries?.() ?? []].filter(isCompactionEntry);
	if (targets.length === 0) {
		await loader.update("compaction-basic", { disabled });
		return [{
			id: "compaction-basic",
			disabled
		}];
	}
	const restore = targets.map((entry) => ({
		id: entry.id,
		disabled: entry.options.disabled
	}));
	for (const entry of targets) {
		await entry.update({ disabled }, false, true);
		entry.parent.tree.write();
	}
	return restore;
}
/**
* Restore the disabled flags recorded by {@link setCompactionEntries}, pairing
* restore records with the tree's current `compaction-basic` entries in order.
* Entries that no longer exist are skipped; a record with `disabled` unset
* removes the flag again (the entry re-inherits its composition default).
* @param loader - the loader service surface.
* @param restore - records previously returned by {@link setCompactionEntries}.
*/
async function restoreCompactionEntries(loader, restore) {
	const targets = [...loader.entries?.() ?? []].filter(isCompactionEntry);
	for (const [index, item] of restore.entries()) {
		const entry = targets[index];
		if (entry === void 0) continue;
		await entry.update({ disabled: item.disabled }, false, true);
		entry.parent.tree.write();
	}
}
async function takeOverCompaction(ctx, config) {
	const loader = loaderOf(ctx);
	if (loader === void 0) {
		ctx.logger.warn("dsh-headroom: no loader available to take over the compaction service; disable compaction-basic in cordis.patch.yml and restart dsh web");
		return;
	}
	try {
		compactionRestore = await setCompactionEntries(loader, true);
		new HeadroomCompactionEngine(ctx, engineConfig(config));
		compactionTakenOver = true;
		ctx.logger.info("dsh-headroom: disabled compaction-basic entries and registered the headroom engine");
	} catch (error) {
		try {
			await restoreCompactionEntries(loader, compactionRestore);
			compactionRestore = [];
		} catch (restoreError) {
			ctx.logger.warn("dsh-headroom: could not restore compaction-basic after takeover failure: %s", message(restoreError));
		}
		ctx.logger.warn("dsh-headroom: could not take over the compaction service: %s", message(error));
	}
}
/**
* Restore the disabled compaction-basic entries when this plugin unloads, so
* the harness keeps a working compaction service after dsh-headroom is
* removed. The restore retries until the headroom engine's `compaction`
* service has been released by this fiber's disposal (disposers run in
* parallel, so the service may still be registered for a moment).
*/
function installTakeoverRollback(ctx) {
	ctx.effect(() => {
		let attempted = false;
		return async () => {
			if (!compactionTakenOver || attempted) return;
			attempted = true;
			const loader = loaderOf(ctx);
			if (loader === void 0) return;
			for (let attempt = 0; attempt < 30; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				try {
					await restoreCompactionEntries(loader, compactionRestore);
					ctx.logger.info("dsh-headroom: restored compaction-basic entries on unload");
					return;
				} catch {}
			}
			ctx.logger.warn("dsh-headroom: could not restore compaction-basic entries on unload; remove their `disabled: true` markers in the loader tree or restart dsh web");
		};
	}, "dsh-headroom: compaction takeover rollback");
}
function serviceConflict(error) {
	return error instanceof Error && error.message.includes("has been registered");
}
function message(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { Config, HEADROOM_ENTRY_ID, HEADROOM_SETTINGS_NS, apply, assertValidEngineConfig, inject, name, restoreCompactionEntries, setCompactionEntries };

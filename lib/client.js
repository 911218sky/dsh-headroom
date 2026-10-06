window.__ModuleLoader__.load({
	id: "@wanyantiande/dsh-headroom",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/config-form-adapter.ts
		function nestedPath(field) {
			switch (field) {
				case "resultCompressionEnabled": return ["resultCompression", "enabled"];
				case "resultCompressionThresholdChars": return ["resultCompression", "thresholdChars"];
				case "command":
				case "pythonPath":
				case "uvCommand":
				case "port":
				case "baseUrl":
				case "autoInstall": return ["headroom", field];
				default: return [field];
			}
		}
		function flatten(value) {
			if (value === void 0) return void 0;
			return {
				command: value.headroom?.command,
				pythonPath: value.headroom?.pythonPath,
				uvCommand: value.headroom?.uvCommand,
				port: value.headroom?.port,
				baseUrl: value.headroom?.baseUrl,
				autoInstall: value.headroom?.autoInstall,
				resultCompressionEnabled: value.resultCompression?.enabled,
				resultCompressionThresholdChars: value.resultCompression?.thresholdChars
			};
		}
		function flattenLayer(layer) {
			if (layer === void 0 || layer === null || typeof layer !== "object") return layer;
			return flatten(layer);
		}
		/** Adapt ConfigForm&lt;nested Config&gt; into the flat scope SettingsFormModel uses. */
		function flatSettingsFormScope(form) {
			return {
				getSnapshot() {
					const snap = form.getSnapshot();
					return {
						status: snap.status,
						value: flatten(snap.value),
						base: flattenLayer(snap.base),
						user: flattenLayer(snap.user),
						revision: snap.revision,
						writable: snap.writable
					};
				},
				subscribe(listener) {
					return form.subscribe(listener);
				},
				mutate(ops, expectedRevision) {
					const nested = ops.map((op) => {
						const field = op.path[0];
						const path = typeof field === "string" ? nestedPath(field) : [...op.path];
						return op.op === "set" ? {
							op: "set",
							path,
							value: op.value
						} : {
							op: "unset",
							path
						};
					});
					return form.mutate(nested, expectedRevision);
				}
			};
		}
		//#endregion
		//#region src/client/HeadroomCard.tsx
		/**
		* Headroom settings card using DSH SettingsForm / SettingsValueField /
		* Checkbox — same chrome as official settings plugins, no plugin CSS.
		*/
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving")
			};
		}
		const TEXT_FIELDS = [
			{
				field: "command",
				label: "commandLabel",
				hint: "commandHint",
				invalid: "invalidText",
				placeholder: "commandPlaceholder"
			},
			{
				field: "pythonPath",
				label: "pythonPathLabel",
				hint: "pythonPathHint",
				invalid: "invalidText",
				placeholder: "pythonPathPlaceholder"
			},
			{
				field: "uvCommand",
				label: "uvCommandLabel",
				hint: "uvCommandHint",
				invalid: "invalidText",
				placeholder: "uvCommandPlaceholder"
			},
			{
				field: "port",
				label: "portLabel",
				hint: "portHint",
				invalid: "invalidPort",
				numeric: true,
				placeholder: "portPlaceholder"
			},
			{
				field: "baseUrl",
				label: "baseUrlLabel",
				hint: "baseUrlHint",
				invalid: "invalidText",
				placeholder: "baseUrlPlaceholder"
			},
			{
				field: "resultCompressionThresholdChars",
				label: "thresholdLabel",
				hint: "thresholdHint",
				invalid: "invalidThreshold",
				numeric: true,
				placeholder: "thresholdPlaceholder"
			}
		];
		/**
		* Render the Headroom settings card.
		* @param props - locale copy, the card snapshot, and its form actions.
		* @returns the form, or a summary one-liner when the Plugins page asks.
		*/
		function HeadroomCard(props) {
			const { t } = props;
			const state = props.useHeadroomCard((snapshot) => snapshot);
			if ("view" in props && props.view === "summary") return t("cardDescription");
			if (!state.available) return null;
			const disabled = !state.writable;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					TEXT_FIELDS.map(({ field, label, hint, invalid, numeric, placeholder }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: `dsh-headroom-${field}`,
						label: t(label),
						hint: t(hint),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t(invalid),
						numeric,
						placeholder: placeholder === void 0 ? void 0 : t(placeholder),
						disabled,
						...state[field],
						onEdit: (text) => props.edit(field, text),
						onReset: () => props.resetField(field)
					}, field)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Checkbox, {
						label: t("autoInstallLabel"),
						checked: state.autoInstall.text !== "false",
						disabled,
						onChange: (checked) => props.edit("autoInstall", checked ? "true" : "false")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Checkbox, {
						label: t("resultCompressionLabel"),
						checked: state.resultCompressionEnabled.text !== "false",
						disabled,
						onChange: (checked) => props.edit("resultCompressionEnabled", checked ? "true" : "false")
					})
				]
			});
		}
		//#endregion
		//#region src/client/headroom-card-controller.ts
		/**
		* Settings card controller built on DSH SettingsFormModel — same pattern as
		* @deepseek-ai/dsh-client-ui-settings-shell. No custom CSS or hand-rolled
		* draft/save state.
		*/
		/** Profile entry id — SettingsForms / configForms key on DSH 0.2. */
		const HEADROOM_NS = "dsh-headroom";
		/** Boolean field as draft text for SettingsFormModel (no built-in boolean helper). */
		function settingsBooleanField(field) {
			return {
				field,
				format: (value) => value === true ? "true" : value === false ? "false" : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					if (trimmed === "true") return {
						kind: "set",
						value: true
					};
					if (trimmed === "false") return {
						kind: "set",
						value: false
					};
				}
			};
		}
		/** Port must be an integer in 1–65535 (schema default sits on the Host). */
		function settingsPortField() {
			return {
				field: "port",
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const trimmed = text.trim();
					if (trimmed === "") return { kind: "clear" };
					const parsed = Number(trimmed);
					if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return void 0;
					return {
						kind: "set",
						value: parsed
					};
				}
			};
		}
		const FIELD_SPECS = [
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("command"),
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("pythonPath"),
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("uvCommand"),
			settingsPortField(),
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("baseUrl"),
			settingsBooleanField("autoInstall"),
			settingsBooleanField("resultCompressionEnabled"),
			(0, _deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("resultCompressionThresholdChars")
		];
		var HeadroomCardController = class {
			form;
			store;
			constructor(scope) {
				this.form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, FIELD_SPECS);
				this.store = this.form.bind(() => this.projection());
			}
			projection() {
				return {
					...this.form.shell(),
					command: this.form.field("command"),
					pythonPath: this.form.field("pythonPath"),
					uvCommand: this.form.field("uvCommand"),
					port: this.form.field("port"),
					baseUrl: this.form.field("baseUrl"),
					autoInstall: this.form.field("autoInstall"),
					resultCompressionEnabled: this.form.field("resultCompressionEnabled"),
					resultCompressionThresholdChars: this.form.field("resultCompressionThresholdChars")
				};
			}
			inject() {
				return {
					hooks: { headroomCard: this.store },
					...this.form.actions()
				};
			}
			dispose() {
				this.form.dispose();
			}
		};
		//#endregion
		//#region src/client/locales.ts
		/** `dsh-headroom` namespace dictionaries (aligned with DSH SettingsForm labels). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			cardTitle: "Headroom 压缩",
			cardDescription: "本地上下文压缩代理：超过阈值时用 Headroom 压缩历史，替代 LLM 总结。",
			commandLabel: "headroom 命令路径",
			commandHint: "留空则自动发现（如 ~/.local/bin/headroom）。",
			commandPlaceholder: "留空自动发现",
			pythonPathLabel: "Python 解释器路径",
			pythonPathHint: "配置后以 python -m headroom 启动（可切换 Python 版本）。",
			pythonPathPlaceholder: "留空不指定",
			uvCommandLabel: "uv 命令路径",
			uvCommandHint: "自动引导安装时使用；留空自动发现。",
			uvCommandPlaceholder: "留空自动发现",
			portLabel: "代理端口",
			portHint: "本地 Headroom 代理监听端口。",
			portPlaceholder: "8787",
			baseUrlLabel: "代理地址",
			baseUrlHint: "留空使用 http://127.0.0.1:<端口>。",
			baseUrlPlaceholder: "留空使用默认",
			autoInstallLabel: "缺少 headroom 时自动安装",
			resultCompressionLabel: "压缩大工具输出",
			thresholdLabel: "工具输出压缩阈值（字符）",
			thresholdHint: "超过该长度的工具输出才会送入压缩。",
			thresholdPlaceholder: "16384",
			invalidThreshold: "阈值必须是 ≥1 的整数。",
			invalidPort: "端口必须是 1–65535 的整数。",
			invalidText: "请填写有效内容；留空表示使用默认值。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			cardTitle: "Headroom compression",
			cardDescription: "Local context-compression proxy: past the threshold, history is compressed by Headroom instead of LLM summarization.",
			commandLabel: "headroom command path",
			commandHint: "Empty = auto-discover (e.g. ~/.local/bin/headroom).",
			commandPlaceholder: "Empty = auto-discover",
			pythonPathLabel: "Python interpreter path",
			pythonPathHint: "When set, runs `python -m headroom` (pin a Python version).",
			pythonPathPlaceholder: "Empty = unset",
			uvCommandLabel: "uv command path",
			uvCommandHint: "Used by auto-install; empty = auto-discover.",
			uvCommandPlaceholder: "Empty = auto-discover",
			portLabel: "Proxy port",
			portHint: "Local Headroom proxy listen port.",
			portPlaceholder: "8787",
			baseUrlLabel: "Proxy base URL",
			baseUrlHint: "Empty = http://127.0.0.1:<port>.",
			baseUrlPlaceholder: "Empty = default",
			autoInstallLabel: "Auto-install headroom when missing",
			resultCompressionLabel: "Compress large tool outputs",
			thresholdLabel: "Tool-output compression threshold (chars)",
			thresholdHint: "Only tool outputs longer than this are compressed.",
			thresholdPlaceholder: "16384",
			invalidThreshold: "Threshold must be a positive integer.",
			invalidPort: "Port must be an integer between 1 and 65535.",
			invalidText: "Enter a valid value, or leave blank to use the default.",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct."
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "dsh-headroom";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/**
		* Mount the Headroom settings card.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const face = ctx;
			ctx.effect(() => face.locale.register(NS, {
				zh,
				en
			}), "dsh-headroom: dictionaries");
			const form = face.configForms?.get?.(HEADROOM_NS);
			if (form === void 0) return;
			const controller = new HeadroomCardController(flatSettingsFormScope(form));
			ctx.effect(() => () => controller.dispose(), "dsh-headroom: card controller lifetime");
			face.slots.inject("settings.plugin.item", function* () {
				yield face.slots.register({
					name: "settings.plugin.item",
					key: HEADROOM_NS,
					locale: NS,
					inject: () => controller.inject()
				}, HeadroomCard);
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

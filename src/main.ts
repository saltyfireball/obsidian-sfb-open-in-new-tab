import {
	FileView,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	Workspace,
	WorkspaceLeaf,
	getLinkpath,
	type App,
	type OpenViewState,
	type PaneType,
	type SplitDirection,
	type TFile,
} from "obsidian";

type EditPaneMode = "source" | "live";
type SplitDir = "vertical" | "horizontal";

interface OpenInNewTabSettings {
	enabled: boolean;
	focusExistingTab: boolean;
	splitPreviewMode: boolean;
	splitDirection: SplitDir;
	editPaneMode: EditPaneMode;
}

const DEFAULT_SETTINGS: OpenInNewTabSettings = {
	enabled: true,
	focusExistingTab: true,
	splitPreviewMode: false,
	splitDirection: "vertical",
	editPaneMode: "source",
};

// Global API for cross-plugin use (e.g. note-toolbar helpers)
declare global {
	interface Window {
		openInNewTabAPI?: {
			isSplitPreviewActive(): boolean;
			toggleSplitPreview(): void;
		};
	}
}

export default class OpenInNewTabPlugin extends Plugin {
	settings: OpenInNewTabSettings = DEFAULT_SETTINGS;

	private originalGetLeaf:
		| ((
				newLeaf?: PaneType | boolean,
				direction?: unknown
		  ) => WorkspaceLeaf)
		| null = null;
	private originalOpenLinkText: Workspace["openLinkText"] | null =
		null;
	private bypassGetLeafPatch = false;
	private forcedLeaves = new WeakSet<WorkspaceLeaf>();

	// Split preview tracking
	private previewLeaf: WorkspaceLeaf | null = null;
	private syncingLeaf = false;

	override onload(): void {
		void this.loadSettings();
		this.addSettingTab(new OpenInNewTabSettingTab(this.app, this));
		this.patchGetLeaf();
		this.patchOpenLinkText();
		this.registerFileOpenHandler();
		this.registerSplitPreviewSync();
		this.registerGlobalAPI();
		this.registerCommands();
	}

	override onunload(): void {
		if (this.originalGetLeaf) {
			this.app.workspace.getLeaf = this.originalGetLeaf;
			this.originalGetLeaf = null;
		}
		if (this.originalOpenLinkText) {
			this.app.workspace.openLinkText =
				this.originalOpenLinkText;
			this.originalOpenLinkText = null;
		}
		delete window.openInNewTabAPI;
	}

	private registerGlobalAPI(): void {
		window.openInNewTabAPI = {
			isSplitPreviewActive: () =>
				this.settings.splitPreviewMode,
			toggleSplitPreview: () => {
				this.toggleSplitPreview();
			},
		};
	}

	private registerCommands(): void {
		this.addCommand({
			id: "toggle-split-preview",
			name: "Toggle split preview mode",
			callback: () => {
				this.toggleSplitPreview();
			},
		});
	}

	toggleSplitPreview(): void {
		this.settings.splitPreviewMode =
			!this.settings.splitPreviewMode;
		void this.saveSettings();
		if (this.settings.splitPreviewMode) {
			this.ensureSplitPreview();
		} else {
			this.closeSplitPreview();
		}
	}

	// --- Split Preview ---

	private isPreviewLeafValid(): boolean {
		return (
			this.previewLeaf !== null &&
			this.previewLeaf.view instanceof FileView
		);
	}

	private ensureSplitPreview(): void {
		const activeView =
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView?.file) return;

		// Set the edit pane to the configured mode
		this.setLeafMode(
			activeView.leaf,
			this.getEditModeState()
		);

		// Check if preview leaf already exists and is valid
		if (this.isPreviewLeafValid()) {
			void this.syncPreviewLeaf(activeView.file);
			return;
		}

		this.createPreviewSplit(activeView.leaf, activeView.file);
	}

	private createPreviewSplit(
		editLeaf: WorkspaceLeaf,
		file: TFile
	): void {
		const direction: SplitDirection =
			this.settings.splitDirection;
		const newLeaf = this.app.workspace.createLeafBySplit(
			editLeaf,
			direction
		);
		this.previewLeaf = newLeaf;

		this.syncingLeaf = true;
		void newLeaf
			.openFile(file, {
				state: { mode: "preview" },
			})
			.then(() => {
				this.syncingLeaf = false;
				// Focus back to the edit pane
				this.app.workspace.setActiveLeaf(editLeaf, {
					focus: true,
				});
			});
	}

	private closeSplitPreview(): void {
		if (this.previewLeaf) {
			this.previewLeaf.detach();
			this.previewLeaf = null;
		}
	}

	private syncPreviewLeaf(file: TFile): Promise<void> {
		if (!this.isPreviewLeafValid()) {
			this.previewLeaf = null;
			return Promise.resolve();
		}

		// If preview already shows this file, skip
		const previewFile = (
			this.previewLeaf as WorkspaceLeaf
		).view;
		if (
			previewFile instanceof FileView &&
			previewFile.file?.path === file.path
		) {
			return Promise.resolve();
		}

		this.syncingLeaf = true;
		return (this.previewLeaf as WorkspaceLeaf)
			.openFile(file, {
				state: { mode: "preview" },
			})
			.then(() => {
				this.syncingLeaf = false;
			});
	}

	private registerSplitPreviewSync(): void {
		this.registerEvent(
			this.app.workspace.on(
				"active-leaf-change",
				(leaf: WorkspaceLeaf | null) => {
					if (
						!leaf ||
						!this.settings.splitPreviewMode ||
						this.syncingLeaf
					) {
						return;
					}

					// If the preview leaf was closed externally, clear the ref
					if (
						this.previewLeaf &&
						!(
							this.previewLeaf.view instanceof
							FileView
						)
					) {
						this.previewLeaf = null;
					}

					if (!(leaf.view instanceof FileView))
						return;
					const file = leaf.view.file;
					if (!file) return;

					// User focused the preview leaf -- sync edit pane to match
					if (leaf === this.previewLeaf) {
						this.syncEditPaneToFile(file);
						return;
					}

					// User focused an edit leaf -- ensure preview exists and sync
					if (leaf.view instanceof MarkdownView) {
						// Set edit pane to configured mode
						this.setLeafMode(
							leaf,
							this.getEditModeState()
						);

						if (!this.isPreviewLeafValid()) {
							// Preview leaf gone, recreate it
							this.createPreviewSplit(
								leaf,
								file
							);
						} else {
							void this.syncPreviewLeaf(file);
						}
					}
				}
			)
		);
	}

	private syncEditPaneToFile(file: TFile): void {
		// Find a markdown leaf that is NOT the preview leaf
		let editLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves(
			(leaf: WorkspaceLeaf) => {
				if (
					editLeaf === null &&
					leaf !== this.previewLeaf &&
					leaf.view instanceof MarkdownView
				) {
					editLeaf = leaf;
				}
			}
		);

		if (!editLeaf) return;

		const editView = (editLeaf as WorkspaceLeaf).view;
		if (
			editView instanceof FileView &&
			editView.file?.path === file.path
		) {
			// Already showing the right file, just focus it
			this.app.workspace.setActiveLeaf(editLeaf, {
				focus: true,
			});
			return;
		}

		// Open the file in the edit leaf
		this.syncingLeaf = true;
		void (editLeaf as WorkspaceLeaf)
			.openFile(file, {
				state: this.getEditModeState(),
			})
			.then(() => {
				this.syncingLeaf = false;
				this.app.workspace.setActiveLeaf(
					editLeaf as WorkspaceLeaf,
					{ focus: true }
				);
			});
	}

	private getEditModeState(): Record<string, unknown> {
		if (this.settings.editPaneMode === "source") {
			return { mode: "source", source: true };
		}
		// live preview
		return { mode: "source", source: false };
	}

	private setLeafMode(
		leaf: WorkspaceLeaf,
		modeState: Record<string, unknown>
	): void {
		if (!(leaf.view instanceof MarkdownView)) return;
		const view = leaf.view;
		const currentState =
			typeof view.getState === "function"
				? view.getState()
				: {};
		const newState = { ...currentState, ...modeState };
		void view.setState(newState, { history: false });
	}

	// --- getLeaf patch ---

	private patchGetLeaf(): void {
		this.originalGetLeaf = this.app.workspace.getLeaf.bind(
			this.app.workspace
		);

		const patchedGetLeaf = (
			newLeaf?: PaneType | boolean,
			direction?: unknown
		): WorkspaceLeaf => {
			if (!this.originalGetLeaf) {
				return new (
					WorkspaceLeaf as new () => WorkspaceLeaf
				)();
			}

			if (
				!this.settings.enabled ||
				this.bypassGetLeafPatch
			) {
				return this.originalGetLeaf(newLeaf, direction);
			}

			// Intercept getLeaf(false) or getLeaf() -- force into new tab
			if (newLeaf === false || newLeaf === undefined) {
				const leaf = this.originalGetLeaf("tab");
				this.forcedLeaves.add(leaf);
				return leaf;
			}

			// true, 'tab' -- already opening new, but track for dedup
			if (newLeaf === true || newLeaf === "tab") {
				const leaf = this.originalGetLeaf(
					newLeaf,
					direction
				);
				this.forcedLeaves.add(leaf);
				return leaf;
			}

			// 'split', 'window' -- pass through without dedup
			return this.originalGetLeaf(newLeaf, direction);
		};
		this.app.workspace.getLeaf =
			patchedGetLeaf as Workspace["getLeaf"];
	}

	// --- openLinkText patch ---

	private patchOpenLinkText(): void {
		this.originalOpenLinkText =
			this.app.workspace.openLinkText.bind(
				this.app.workspace
			);

		this.app.workspace.openLinkText = (
			linktext: string,
			sourcePath: string,
			newLeaf?: PaneType | boolean,
			openViewState?: OpenViewState
		): Promise<void> => {
			if (!this.originalOpenLinkText) {
				return Promise.resolve();
			}

			if (!this.settings.enabled) {
				return this.originalOpenLinkText(
					linktext,
					sourcePath,
					newLeaf,
					openViewState
				);
			}

			// Check if this is same-file heading/block navigation
			const linkPath = getLinkpath(linktext);
			const hasSubpath =
				linktext.includes("#") ||
				linktext.includes("^");

			if (hasSubpath && linkPath === "") {
				// Pure heading/block link like #heading or ^block -- stay in current tab
				this.bypassGetLeafPatch = true;
				const result = this.originalOpenLinkText(
					linktext,
					sourcePath,
					newLeaf,
					openViewState
				);
				void result.finally(() => {
					this.bypassGetLeafPatch = false;
				});
				return result;
			}

			// Check if this links to the same file we're currently viewing
			if (hasSubpath && linkPath !== "") {
				const targetFile =
					this.app.metadataCache.getFirstLinkpathDest(
						linkPath,
						sourcePath
					);
				const activeFile =
					this.app.workspace.getActiveFile();
				if (
					targetFile &&
					activeFile &&
					targetFile.path === activeFile.path
				) {
					this.bypassGetLeafPatch = true;
					const result = this.originalOpenLinkText(
						linktext,
						sourcePath,
						newLeaf,
						openViewState
					);
					void result.finally(() => {
						this.bypassGetLeafPatch = false;
					});
					return result;
				}
			}

			// Check if target file is already open in another tab
			if (this.settings.focusExistingTab) {
				const targetFile =
					this.app.metadataCache.getFirstLinkpathDest(
						linkPath || linktext,
						sourcePath
					);
				if (targetFile) {
					const existingLeaf =
						this.findLeafWithFile(
							targetFile.path
						);
					if (existingLeaf) {
						this.app.workspace.setActiveLeaf(
							existingLeaf,
							{ focus: true }
						);
						if (hasSubpath) {
							this.bypassGetLeafPatch = true;
							const result =
								this.originalOpenLinkText(
									linktext,
									sourcePath,
									false,
									openViewState
								);
							void result.finally(() => {
								this.bypassGetLeafPatch =
									false;
							});
							return result;
						}
						return Promise.resolve();
					}
				}
			}

			return this.originalOpenLinkText(
				linktext,
				sourcePath,
				newLeaf,
				openViewState
			);
		};
	}

	// --- file-open handler for focus-existing-tab ---

	private registerFileOpenHandler(): void {
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (
					!file ||
					!this.settings.enabled ||
					!this.settings.focusExistingTab ||
					this.syncingLeaf
				) {
					return;
				}

				// Collect ALL non-preview leaves showing this file
				const leaves: WorkspaceLeaf[] = [];
				this.app.workspace.iterateAllLeaves(
					(leaf: WorkspaceLeaf) => {
						if (
							leaf !== this.previewLeaf &&
							leaf.view instanceof FileView &&
							leaf.view.file != null &&
							leaf.view.file.path ===
								file.path
						) {
							leaves.push(leaf);
						}
					}
				);

				if (leaves.length <= 1) return;

				// Keep the leaf NOT created by our patch (the original)
				const keepLeaf =
					leaves.find(
						(l) => !this.forcedLeaves.has(l)
					) ?? leaves[0];

				// Defer detach to avoid conflicts with Obsidian's
				// internal state during the file-open event cycle
				const toDetach = leaves.filter(
					(l) => l !== keepLeaf
				);
				window.setTimeout(() => {
					for (const leaf of toDetach) {
						this.forcedLeaves.delete(leaf);
						if (leaf.view instanceof FileView) {
							leaf.detach();
						}
					}
				}, 0);

				this.app.workspace.setActiveLeaf(keepLeaf, {
					focus: true,
				});
			})
		);
	}

	// --- Helpers ---

	private findLeafWithFile(
		path: string,
		exclude?: WorkspaceLeaf | null
	): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves(
			(leaf: WorkspaceLeaf) => {
				if (
					found === null &&
					leaf !== exclude &&
					leaf !== this.previewLeaf &&
					leaf.view instanceof FileView &&
					leaf.view.file != null &&
					leaf.view.file.path === path
				) {
					found = leaf;
				}
			}
		);
		return found;
	}

	private loadSettings(): Promise<void> {
		return this.loadData().then(
			(data: Partial<OpenInNewTabSettings> | null) => {
				this.settings = Object.assign(
					{},
					DEFAULT_SETTINGS,
					data
				);
			}
		);
	}

	saveSettings(): Promise<void> {
		return this.saveData(this.settings);
	}
}

class OpenInNewTabSettingTab extends PluginSettingTab {
	plugin: OpenInNewTabPlugin;

	constructor(app: App, plugin: OpenInNewTabPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Enable open in new tab")
			.setDesc(
				"When enabled, files that would normally open in the current tab will open in a new tab instead."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange((value) => {
						this.plugin.settings.enabled = value;
						void this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Focus existing tab")
			.setDesc(
				"When enabled, if the target file is already open in another tab, " +
					"focus that tab instead of opening a duplicate."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.focusExistingTab
					)
					.onChange((value) => {
						this.plugin.settings.focusExistingTab =
							value;
						void this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Split preview mode")
			.setHeading();

		new Setting(containerEl)
			.setName("Enable split preview")
			.setDesc(
				"Automatically create a split with one pane for editing and one for preview. " +
					"Switching files in either pane syncs the other."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.splitPreviewMode
					)
					.onChange((value) => {
						this.plugin.settings.splitPreviewMode =
							value;
						void this.plugin.saveSettings();
						if (value) {
							this.plugin[
								"ensureSplitPreview"
							]();
						} else {
							this.plugin[
								"closeSplitPreview"
							]();
						}
					})
			);

		new Setting(containerEl)
			.setName("Split direction")
			.setDesc(
				"Direction of the preview split. Vertical places preview to the right, horizontal places it below."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("vertical", "Right")
					.addOption("horizontal", "Down")
					.setValue(
						this.plugin.settings.splitDirection
					)
					.onChange((value) => {
						this.plugin.settings.splitDirection =
							value as SplitDir;
						void this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Edit pane mode")
			.setDesc(
				"The editing mode for the left/top pane. The right/bottom pane is always reading view."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("source", "Source mode")
					.addOption("live", "Live preview")
					.setValue(
						this.plugin.settings.editPaneMode
					)
					.onChange((value) => {
						this.plugin.settings.editPaneMode =
							value as EditPaneMode;
						void this.plugin.saveSettings();
					})
			);
	}
}

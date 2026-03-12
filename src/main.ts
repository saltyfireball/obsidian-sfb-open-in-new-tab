import {
	FileView,
	Plugin,
	PluginSettingTab,
	Setting,
	Workspace,
	WorkspaceLeaf,
	getLinkpath,
	type App,
	type OpenViewState,
	type PaneType,
} from "obsidian";

interface OpenInNewTabSettings {
	enabled: boolean;
	focusExistingTab: boolean;
}

const DEFAULT_SETTINGS: OpenInNewTabSettings = {
	enabled: true,
	focusExistingTab: true,
};

export default class OpenInNewTabPlugin extends Plugin {
	settings: OpenInNewTabSettings = DEFAULT_SETTINGS;

	private originalGetLeaf:
		| ((
				newLeaf?: PaneType | boolean,
				direction?: unknown
		  ) => WorkspaceLeaf)
		| null = null;
	private originalOpenLinkText: Workspace["openLinkText"] | null = null;
	private bypassGetLeafPatch = false;
	private forcedNewTab = false;

	override onload(): void {
		void this.loadSettings();
		this.addSettingTab(new OpenInNewTabSettingTab(this.app, this));
		this.patchGetLeaf();
		this.patchOpenLinkText();
		this.registerFileOpenHandler();
	}

	override onunload(): void {
		if (this.originalGetLeaf) {
			this.app.workspace.getLeaf = this.originalGetLeaf;
			this.originalGetLeaf = null;
		}
		if (this.originalOpenLinkText) {
			this.app.workspace.openLinkText = this.originalOpenLinkText;
			this.originalOpenLinkText = null;
		}
	}

	private patchGetLeaf(): void {
		this.originalGetLeaf = this.app.workspace.getLeaf.bind(
			this.app.workspace
		);

		const patchedGetLeaf = (
			newLeaf?: PaneType | boolean,
			direction?: unknown
		): WorkspaceLeaf => {
			if (!this.originalGetLeaf) {
				return new (WorkspaceLeaf as new () => WorkspaceLeaf)();
			}

			if (!this.settings.enabled || this.bypassGetLeafPatch) {
				return this.originalGetLeaf(newLeaf, direction);
			}

			// Only intercept getLeaf(false) or getLeaf() -- the "reuse current tab" calls
			if (newLeaf === false || newLeaf === undefined) {
				this.forcedNewTab = true;
				return this.originalGetLeaf("tab");
			}

			// true, 'tab', 'split', 'window' -- already opening new, pass through
			return this.originalGetLeaf(newLeaf, direction);
		};
		this.app.workspace.getLeaf =
			patchedGetLeaf as Workspace["getLeaf"];
	}

	private patchOpenLinkText(): void {
		this.originalOpenLinkText =
			this.app.workspace.openLinkText.bind(this.app.workspace);

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
				linktext.includes("#") || linktext.includes("^");

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
					// Same file with heading -- stay in current tab
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
					const existingLeaf = this.findLeafWithFile(
						targetFile.path
					);
					if (existingLeaf) {
						this.app.workspace.setActiveLeaf(
							existingLeaf,
							{ focus: true }
						);
						// If there's a subpath, still navigate to the heading/block
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
								this.bypassGetLeafPatch = false;
							});
							return result;
						}
						return Promise.resolve();
					}
				}
			}

			// Default: let getLeaf patch handle new tab behavior
			return this.originalOpenLinkText(
				linktext,
				sourcePath,
				newLeaf,
				openViewState
			);
		};
	}

	private registerFileOpenHandler(): void {
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (
					!file ||
					!this.settings.enabled ||
					!this.settings.focusExistingTab ||
					!this.forcedNewTab
				) {
					this.forcedNewTab = false;
					return;
				}
				this.forcedNewTab = false;

				// Find the leaf that just opened this file (the active one)
				const activeLeaf =
					this.app.workspace.getActiveViewOfType(FileView)
						?.leaf ?? null;
				if (!activeLeaf) return;

				// Look for another leaf with the same file
				const existingLeaf = this.findLeafWithFile(
					file.path,
					activeLeaf
				);
				if (existingLeaf) {
					// Focus the existing tab and close the duplicate
					this.app.workspace.setActiveLeaf(existingLeaf, {
						focus: true,
					});
					activeLeaf.detach();
				}
			})
		);
	}

	private findLeafWithFile(
		path: string,
		exclude?: WorkspaceLeaf | null
	): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (
				found === null &&
				leaf !== exclude &&
				leaf.view instanceof FileView &&
				leaf.view.file !== null &&
				leaf.view.file.path === path
			) {
				found = leaf;
			}
		});
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
				"When enabled, files that would normally open in the current tab will open in a new tab instead. " +
					"Modifier keys (Cmd/Ctrl+click for split, etc.) continue to work as expected."
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
					.setValue(this.plugin.settings.focusExistingTab)
					.onChange((value) => {
						this.plugin.settings.focusExistingTab = value;
						void this.plugin.saveSettings();
					})
			);
	}
}

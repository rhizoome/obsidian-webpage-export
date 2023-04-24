// imports from obsidian API
import { Component, Notice, Plugin, TFile, TFolder} from 'obsidian';

// modules that are part of the plugin
import { ExportModal, ExportSettings } from './export-settings';
import { Utils, Downloadable } from './utils';
import { HTMLGenerator } from './html-gen';
const {shell} = require('electron') 

export default class HTMLExportPlugin extends Plugin
{
	htmlGenerator: HTMLGenerator = new HTMLGenerator("webpage-html-export");
	static plugin: HTMLExportPlugin;

	addTogglePostprocessor()
	{
		this.registerMarkdownCodeBlockProcessor("theme-toggle", (source, el, ctx) =>
		{
			let toggleEl = this.htmlGenerator.generateDarkmodeToggle();
			el.replaceWith(toggleEl);
		});

		//also replace `theme-toggle` and ```theme-toggle``` for better inline toggles, or in places you couldn't use a normal code block
		this.registerMarkdownPostProcessor((element, context) =>
		{
			let codeBlocks = element.querySelectorAll('code, span.cm-inline-code');
			codeBlocks.forEach((codeBlock) =>
			{
				if (codeBlock instanceof HTMLElement && codeBlock.innerText == "theme-toggle")
				{
					let toggleEl = this.htmlGenerator.generateDarkmodeToggle();
					codeBlock.replaceWith(toggleEl);
				}
			});
		});
	}

	async addCommands()
	{
		this.addCommand({
			id: 'export-html-file',
			name: 'Export current file to HTML',
			checkCallback: (checking: boolean) =>
			{
				let file = (Utils.getActiveTextView())?.file;
				if(file instanceof TFile)
				{
					if(checking) return true;

					this.exportFile(file);
				}

				return false;
			}
		});

		this.addCommand({
			id: 'export-html-vault',
			name: 'Export vault to HTML',
			callback: () =>
			{
				this.exportFolder("");
			}
		});
	}

	async onload()
	{
		console.log('loading webpage-html-export plugin');
		HTMLExportPlugin.plugin = this;

		// init settings
		this.addSettingTab(new ExportSettings(this));
		ExportSettings.loadSettings();

		// add export vault icon to ribbon
		this.addRibbonIcon("folder-up", "Export Vault to HTML", async () =>
		{
			this.exportFolder("");
		});

		// add toggle postprocessor
		this.addTogglePostprocessor();

		// add commands
		this.addCommands();

		// init html generator
		this.htmlGenerator.initialize();

		// Register the Export As HTML button in the file menu
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) =>
			{
				menu.addItem((item) =>
				{
					item
						.setTitle("Export to HTML")
						.setIcon("download")
						.setSection("export")
						.onClick(async () =>
						{
							if(file instanceof TFile)
							{
								let success = await this.exportFile(file);
								if (success && ExportSettings.settings.openAfterExport)
								{
									shell.openPath(ExportSettings.settings.lastExportPath);
								}
							}
							else if(file instanceof TFolder)
							{
								let success = await this.exportFolder(file.path);
								if (success && ExportSettings.settings.openAfterExport)
								{
									shell.openPath(ExportSettings.settings.lastExportPath);
								}
							}
							else
							{
								console.error("File is not a TFile or TFolder! Invalid type: " + typeof file + "");
								new Notice("File is not a File or Folder! Invalid type: " + typeof file + "", 5000);
							}
						});
				});
			})
		);

	}

	onunload()
	{
		console.log('unloading webpage-html-export plugin');
	}

	async exportFile(file: TFile, partOfBatch: boolean = false, exportPath: string | undefined = undefined, showSettings: boolean = true) : Promise<{success: boolean, externalFiles: Downloadable[], exportPath: string}>
	{
		// Open the settings modal and wait until it's closed
		if (showSettings)
		{
			let validSelection = false;
			while (!validSelection)
			{
				let result = await new ExportModal().open();
				if (result.canceled) return {success: false, externalFiles: [], exportPath: ""};

				validSelection = true;
			}
		}

		let exportPathParsed = Utils.parsePath(exportPath ?? "");
		if (exportPath === undefined) // if no export path is specified, show a save dialog
		{
			let defaultFileName = (ExportSettings.settings.makeNamesWebStyle ? Utils.makePathWebStyle(file.basename) : file.basename) + ".html";
			let saveDialogPath = await Utils.showSaveDialog(Utils.idealDefaultPath(), defaultFileName, false) ?? undefined;
			if (saveDialogPath == undefined) return {success: false, externalFiles: [], exportPath: ""};
			exportPathParsed = Utils.parsePath(saveDialogPath);
		}

		let webpageData = await this.htmlGenerator.generateWebpage(file);
		let externalFiles = webpageData.externalFiles;

		if(ExportSettings.settings.makeNamesWebStyle)
		{
			externalFiles.forEach((file) =>
			{
				file.filename = Utils.makePathWebStyle(file.filename);
				file.relativePath = Utils.makePathWebStyle(file.relativePath ?? "");
			});
		}

		if(!partOfBatch) 
		{
			new Notice("Exported " + file.name + " to " + exportPathParsed.fullPath, 5000);
			Utils.downloadFiles(externalFiles, exportPathParsed.dir);
		}

		return {success: true, externalFiles: externalFiles, exportPath: exportPathParsed.dir};
	}

	async exportFolder(folderPath: string, showSettings: boolean = true) : Promise<boolean>
	{
		// folder path is the path relative to the vault that we are exporting

		// Open the settings modal and wait until it's closed
		if (showSettings)
		{
			let validSelection = false;
			while (!validSelection)
			{
				let result = await new ExportModal().open();
				if (result.canceled) return false;
				
				validSelection = true;
			}
		}

		let htmlPath = await Utils.showSelectFolderDialog(Utils.parsePath(Utils.idealDefaultPath()).dir);
		if (!htmlPath) return false;

		let files = this.app.vault.getFiles();

		let externalFiles: Downloadable[] = [];


		// 10 characters for the progress bar
		let exportProgress = new Notice(`Generating HTML Files: ${files[0].name} \n\n[          ] 1 / ${files.length}`, 1000000);
		
		for (let i = 0; i < files.length; i++)
		{
			let file = files[i];
			if (file.path.startsWith(folderPath) && file.extension == "md")
			{
				let fullPath = "";
				if(ExportSettings.settings.makeNamesWebStyle)
					fullPath = Utils.joinPaths(htmlPath, Utils.makePathWebStyle(Utils.parsePath(file.path).dir), Utils.makePathWebStyle(file.basename + ".html"));
				else
					fullPath = Utils.joinPaths(htmlPath, Utils.parsePath(file.path).dir, file.basename + ".html");
				let exportInfo = await this.exportFile(file, true, fullPath, false);
				if (exportInfo.success) externalFiles.push(...exportInfo.externalFiles);

				// update progress bar
				exportProgress.setMessage(`Generating HTML Files:\n\n[${"█".repeat(Math.floor((i / files.length) * 10))}${" ".repeat(10 - Math.floor((i / files.length) * 10))}]  ${i+1} / ${files.length}`);
			}
		}

		exportProgress.hide();

		// remove duplicates and download
		externalFiles = externalFiles.filter((file, index) => externalFiles.findIndex((f) => f.relativePath == file.relativePath && f.filename == file.filename) == index);
		await Utils.downloadFiles(externalFiles, htmlPath);

		new Notice("Finished export to " + htmlPath, 5000);

		return true;
	}
}

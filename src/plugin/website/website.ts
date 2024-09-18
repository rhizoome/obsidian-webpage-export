import { Attachment } from "src/plugin/utils/downloadable";
import { FileTree } from "src/plugin/features/file-tree";
import {  TAbstractFile, TFile, TFolder } from "obsidian";
import {  Settings } from "src/plugin/settings/settings";
import { Path } from "src/plugin/utils/path";
import { ExportLog, MarkdownRendererAPI } from "src/plugin/render-api/render-api";
import { AssetLoader } from "src/plugin/asset-loaders/base-asset";
import { AssetType, InlinePolicy, Mutability } from "src/plugin/asset-loaders/asset-types.js";
import { HTMLGeneration } from "src/plugin/render-api/html-generation-helpers";
import { ExportPipelineOptions } from "src/plugin/website/pipeline-options.js";
import { Index as WebsiteIndex } from "src/plugin/website/index";
import { WebpageData } from "src/plugin/../shared/website-data";
import { WebpageTemplate } from "./webpage-template";
import { AssetHandler } from "src/plugin/asset-loaders/asset-handler";
import { Webpage } from "./webpage";
import { GraphView } from "src/plugin/features/graph-view";
import { ThemeToggle } from "src/plugin/features/theme-toggle";
import { SearchInput } from "src/plugin/features/search-input";
import { Utils } from "src/plugin/utils/utils";
import { IconHandler } from "src/plugin/utils/icon-handler";

export class Website
{
	public destination: Path;
	public index: WebsiteIndex;
	
	private sourceFiles: TFile[] = [];

	public fileTree: FileTree;
	public fileTreeAsset: AssetLoader;
	public webpageTemplate: WebpageTemplate;
	
	public bodyClasses: string;
	public exportOptions: ExportPipelineOptions;

	constructor(destination: Path | string, options?: ExportPipelineOptions)
	{
		if (typeof destination == "string") destination = new Path(destination);
		this.exportOptions = Object.assign(Settings.exportOptions, options);
		if (destination.isFile) throw new Error("Website destination must be a folder: " + destination.path);
		this.destination = destination;
	}

	private async buildTemplate(): Promise<void>
	{
		const template = this.webpageTemplate;
		await template.loadLayout();
			
		// inject graph view
		if (this.exportOptions.graphViewOptions.enabled)
		{
			template.insertFeature(await new GraphView().generate(), this.exportOptions.graphViewOptions);
		}

		// inject darkmode toggle
		if (this.exportOptions.themeToggleOptions.enabled)
		{
			template.insertFeature(await new ThemeToggle().generate(), this.exportOptions.themeToggleOptions);
		}

		// inject search bar
		if (this.exportOptions.searchOptions.enabled)
		{
			template.insertFeature(await new SearchInput().generate(), this.exportOptions.searchOptions);
		}

		// inject file tree
		if (this.exportOptions.fileNavigationOptions.enabled)
		{
			const fileTreeElContainer = document.body.createDiv();
			fileTreeElContainer.innerHTML = this.fileTreeAsset.getHTML(this.exportOptions);
			const fileTreeEl = fileTreeElContainer.firstElementChild as HTMLElement;

			template.insertFeature(fileTreeEl, this.exportOptions.fileNavigationOptions);
			fileTreeElContainer.remove();
		}

		// inject custom head content
		if (this.exportOptions.customHeadOptions.enabled)
		{
			let string = AssetHandler.customHeadContent.getHTML(this.exportOptions);
			template.insertFeatureString(string, this.exportOptions.customHeadOptions);
		}
	}

	public async load(files?: TFile[]): Promise<this>
	{
		this.sourceFiles = files?.filter((file) => file) ?? [];
		this.bodyClasses = await HTMLGeneration.getValidBodyClasses(true);

		// Find root path
		try
		{
			if (this.exportOptions.exportRoot == "" && files)
			{
				if (this.sourceFiles.length > 1)
				{ 
					let commonPath = "";
					let paths = this.sourceFiles.map((file) => file.path.split("/"));
					while (paths.every((path) => path[0] == paths[0][0]))
					{
						commonPath += paths[0][0] + "/";
						paths = paths.map((path) => path.slice(1));
						
						const anyEmpty = paths.some((path) => path.length == 1);
						if (anyEmpty) break;
					}
					console.log("Export root path: " + commonPath);
					this.exportOptions.exportRoot = new Path(commonPath).path + "/";
				}
				else this.exportOptions.exportRoot = this.sourceFiles[0].parent?.path ?? "";
			}
		}
		catch (error)
		{
			ExportLog.error(error, "Problem finding export root");
		}

		await AssetHandler.reloadAssets(this.exportOptions);
		this.index = new WebsiteIndex();
		try
		{
			await this.index.load(this, this.exportOptions);
		}
		catch (error)
		{
			ExportLog.error(error, "Problem loading index");
		}

		try
		{
			this.webpageTemplate = new WebpageTemplate(this.exportOptions, this.index.rssURL.path);
		}
		catch (error)
		{
			ExportLog.error(error, "Problem creating webpage template");
		}

		// create webpages
		for (const file of this.sourceFiles)
		{
			try
			{
				const isConvertable = MarkdownRendererAPI.isConvertable(file.extension);

				if (!isConvertable || (MarkdownRendererAPI.viewableMediaExtensions.contains(file.extension)))
				{
					const data = Buffer.from(await app.vault.readBinary(file));
					const path = this.getTargetPathForFile(file);
					let attachment = new Attachment(data, path, file, this.exportOptions);
					attachment.showInTree = true;
					await this.index.addFile(attachment);
				}

				if (isConvertable)
				{
					let webpage = new Webpage(file, file.name, this, this.exportOptions);
					webpage.showInTree = true;
					await this.index.addFile(webpage);
				}
			}
			catch (error)
			{
				ExportLog.error(error, "Problem initializing document: " + file.path);
				continue;
			}
		}

		try
		{
			// create file tree asset
			if (this.exportOptions.fileNavigationOptions.enabled)
			{
				const paths = this.index.attachmentsShownInTree.map((file) => new Path(file.sourcePathRootRelative ?? ""));
				this.fileTree = new FileTree(paths, false, true);
				this.fileTree.makeLinksWebStyle = this.exportOptions.slugifyPaths ?? true;
				this.fileTree.showNestingIndicator = true;
				this.fileTree.generateWithItemsClosed = true;
				this.fileTree.showFileExtentionTags = true;
				this.fileTree.hideFileExtentionTags = ["md"];
				this.fileTree.title = this.exportOptions.siteName ?? app.vault.getName();
				this.fileTree.id = "file-explorer";
				const tempContainer = document.createElement("div");
				await this.fileTree.generate(tempContainer);
				const data = tempContainer.innerHTML;
				tempContainer.remove();
				this.fileTreeAsset = new AssetLoader("file-tree.html", data, null, AssetType.HTML, InlinePolicy.Auto, true, Mutability.Temporary);
			}
		}
		catch (error)
		{
			ExportLog.error(error, "Problem creating file tree");
		}

		return this;
	}
	
	/**
	 * Create a new website with the given files and options.
	 * @param files The files to include in the website.
	 * @param destination The folder to export the website to.
	 * @param options The api options to use for the export.
	 * @returns The website object.
	 */
	public async build(files?: TFile[]): Promise<Website | undefined>
	{ 
		if (files) await this.load(files);

		console.log("Creating website with files: ", this.sourceFiles);

		await this.buildTemplate();
		
		this.refreshUpdatedFilesList();
		
		// if body classes have changed write new body classes to existing files
		if (this.bodyClasses != (this.index.oldWebsiteData?.bodyClasses ?? this.bodyClasses))
		{
			await this.index.applyToOldWebpages(async (document: Document, oldData: WebpageData) => 
			{
				document.body.className = this.bodyClasses;
				ExportLog.progress(0, "Updating Body Classes", oldData.sourcePath);
			});
		}

		await MarkdownRendererAPI.beginBatch(this.exportOptions);
		this.validateSettings();

		// only render the updated and new files
		let webpages = this.index.webpages;
		webpages = webpages.filter((webpage) => 
		{
			return this.index.updatedFiles.includes(webpage) || this.index.newFiles.includes(webpage)
		});

		this.index.addFiles(AssetHandler.getDownloads(this.destination, this.exportOptions));

		
		let progress = 0;
		for (const webpage of webpages)
		{
			if (ExportLog.isCancelled()) return;

			const rendered = await webpage.renderDocument();
			if (!rendered) continue;
			await Utils.delay(0);
			const attachments = await webpage.getAttachments();
			await Utils.delay(0);
			this.index.addFiles(attachments);
			await Utils.delay(0);
			const built = await webpage.build();
			await Utils.delay(0);
			if (built) await this.index.addFile(webpage);
			else await this.index.removeFile(webpage);

			// save the file and then dispose of the webpage
			if (!this.exportOptions.combineAsSingleFile)
				await webpage.download();
			
			if (this.exportOptions.autoDisposeWebpages)
				webpage.dispose();

			ExportLog.progress(progress / webpages.length, "Building Website", webpage.source.path);
			progress += 1;

			await Utils.delay(0);
		}
	
		if (this.exportOptions.addRSS)
		{
			try
			{
				this.index.createRSSFeed();
			}
			catch (error)
			{
				ExportLog.error(error, "Problem creating RSS feed");
			}
		}

		console.log("Website created: ", this);
		
		try
		{
			await this.index.finalize();
		}
		catch (error)
		{
			ExportLog.error(error, "Problem finalizing index");
		}

		this.refreshUpdatedFilesList();

		this.validateSite();
		return this;
	}

	/** 
	 * Display updated files on the render window
	 * */ 
	private refreshUpdatedFilesList()
	{
		try
		{
			let updatedNames = this.index.updatedFiles.map((file) => file.filename);
			updatedNames.concat(this.index.newFiles.map((file) => file.filename));
			if (updatedNames.length == 0) updatedNames = ["None Updated"];
			ExportLog.setFileList(updatedNames, 
			{
				icons: "file",
				renderAsMarkdown: false,
				title: "Updated & New"
			});
		}
		catch (error)
		{
			ExportLog.warning(error, "Problem updating changed files display list on render window");
		}
	}

	private validateSettings()
	{
		// if iconize plugin is installed, warn if note icons are not enabled
		// @ts-ignore
		if (app.plugins?.enabledPlugins?.has("obsidian-icon-folder"))
		{
			// @ts-ignore
			const fileToIconName = app.plugins?.plugins?.['obsidian-icon-folder']?.data;
			const noteIconsEnabled = fileToIconName?.settings?.iconsInNotesEnabled ?? false;
			if (!noteIconsEnabled)
			{
				ExportLog.warning("For Iconize plugin support, enable \"Toggle icons while editing notes\" in the Iconize plugin settings.");
			}
		}

		// if excalidraw installed and the embed mode is not set to Native SVG, warn
		// @ts-ignore
		if (app.plugins?.enabledPlugins?.has("obsidian-excalidraw-plugin"))
		{
			// @ts-ignore
			const embedMode = app.plugins?.plugins?.['obsidian-excalidraw-plugin']?.settings?.['previewImageType'] ?? "";		
			if (embedMode != "SVG")
			{
				ExportLog.warning("For Excalidraw embed support, set the embed mode to \"Native SVG\" in the Excalidraw plugin settings.");
			}
		}

		// the plugin only supports the banner plugin above version 2.0.5
		// @ts-ignore
		if (app.plugins?.enabledPlugins?.has("obsidian-banners"))
		{
			// @ts-ignore
			const bannerPlugin = app.plugins?.plugins?.['obsidian-banners'];
			let version = bannerPlugin?.manifest?.version ?? "0.0.0";
			version = version?.substring(0, 5);
			if (version < "2.0.5")
			{
				ExportLog.warning("The Banner plugin version 2.0.5 or higher is required for full support. You have version " + version + ".");
			}
		}

		// warn the user if they are trying to create an rss feed without a site url
		if (this.exportOptions.addRSS && (this.exportOptions.siteURL == "" || this.exportOptions.siteURL == undefined))
		{
			ExportLog.warning("Creating an RSS feed requires a site url to be set in the export settings.");
		}

	}

	/**
	 * Run some checks to make sure certain formatting and element rules are followed everywhere.
	 */
	private validateSite()
	{
		// check for .feature-title elements not inside a .feature-header
		this.index.webpages.forEach(async (webpage: Webpage) => 
		{
			const titles = webpage.pageDocument?.querySelectorAll(".feature-title");
			if (!titles) return;
			titles.forEach(async (title: HTMLElement) => 
			{
				if (!title.closest(".feature-header"))
				{
					ExportLog.warning(title, `Feature title not inside a feature header in ${webpage.source.path}`);
				}
			});
			await Utils.delay(0);
		});
	}

	public getTargetPathForFile(file: TFile, filename?: string): Path
	{
		const targetPath = new Path(file.path);
		if (filename) targetPath.fullName = filename;
		targetPath.setWorkingDirectory((this.destination ?? Path.vaultPath.joinString("Web Export")).path);
		targetPath.slugify(this.exportOptions.slugifyPaths);
		return targetPath;
	}

	public static async getIcon(file: TAbstractFile): Promise<{ icon: string; isDefault: boolean }>
	{
		if (!file) return { icon: "", isDefault: true };

		let iconOutput = "";
		let iconProperty: string | undefined = "";
		let useDefaultIcon = false;

		if (file instanceof TFile)
		{
			const fileCache = app.metadataCache.getFileCache(file);
			const frontmatter = fileCache?.frontmatter;
			iconProperty = frontmatter?.icon ?? frontmatter?.sticker ?? frontmatter?.banner_icon; // banner plugin support
			if (!iconProperty && Settings.exportOptions.fileNavigationOptions.showDefaultFileIcons) 
			{
				useDefaultIcon = true;
				const isMedia = AssetLoader.extentionToType(file.extension) == AssetType.Media;
				iconProperty = isMedia ? Settings.exportOptions.fileNavigationOptions.defaultMediaIcon : Settings.exportOptions.fileNavigationOptions.defaultFileIcon;
				if (file.extension == "canvas") iconProperty = "lucide//layout-dashboard";
			}
		}
		
		if (file instanceof TFolder && Settings.exportOptions.fileNavigationOptions.showDefaultFolderIcons)
		{
			iconProperty = Settings.exportOptions.fileNavigationOptions.defaultFolderIcon;
			useDefaultIcon = true;
		}

		iconOutput = await IconHandler.getIcon(iconProperty ?? "");

		// add iconize icon as frontmatter if iconize exists
		const isUnchangedNotEmojiNotHTML = (iconProperty == iconOutput && iconOutput.length < 40) && !/\p{Emoji}/u.test(iconOutput) && !iconOutput.includes("<") && !iconOutput.includes(">");
		let parsedAsIconize = false;

		//@ts-ignore
		if ((useDefaultIcon || !iconProperty || isUnchangedNotEmojiNotHTML) && app.plugins.enabledPlugins.has("obsidian-icon-folder"))
		{
			//@ts-ignore
			const fileToIconName = app.plugins.plugins['obsidian-icon-folder'].data;
			const noteIconsEnabled = fileToIconName.settings.iconsInNotesEnabled ?? false;
			
			// only add icon if rendering note icons is enabled
			// bectheause that is what we rely on to get  icon
			if (noteIconsEnabled)
			{
				const iconIdentifier = fileToIconName.settings.iconIdentifier ?? ":";
				let iconProperty = fileToIconName[file.path];

				if (iconProperty && typeof iconProperty != "string")
				{
					iconProperty = iconProperty.iconName ?? "";
				}

				if (iconProperty && typeof iconProperty == "string" && iconProperty.trim() != "")
				{
					if (file instanceof TFile)
						app.fileManager.processFrontMatter(file, (frontmatter) =>
						{
							frontmatter.icon = iconProperty;
						});

					iconOutput = iconIdentifier + iconProperty + iconIdentifier;
					parsedAsIconize = true;
				}
			}
		}

		if (!parsedAsIconize && isUnchangedNotEmojiNotHTML) iconOutput = "";

		return { icon: iconOutput, isDefault: useDefaultIcon };
	}

	public static async getTitle(file: TAbstractFile): Promise<{ title: string; isDefault: boolean }>
	{
		let title = file.name;
		let isDefaultTitle = true;
		if (file instanceof TFile)
		{
			const fileCache = app.metadataCache.getFileCache(file);
			const frontmatter = fileCache?.frontmatter;
			const titleFromFrontmatter = frontmatter?.[Settings.titleProperty] ?? frontmatter?.["banner_header"]; // banner plugin support
			title = (titleFromFrontmatter ?? file.basename).toString() ?? "";

			if (title.endsWith(".excalidraw")) 
			{
				title = title.substring(0, title.length - 11);
			}

			if (title != file.basename) 
			{
				isDefaultTitle = false;
			}
		}

		if (file instanceof TFolder)
		{
			title = file.name;
			isDefaultTitle = true;
		}

		return { title: title, isDefault: isDefaultTitle };
	}

	public async createAttachmentFromSrc(src: string, sourceFile: TFile): Promise<Attachment | undefined>
	{
		const attachedFile = this.getFilePathFromSrc(src, sourceFile.path);
		if (attachedFile.isDirectory) return;

		const file = app.vault.getFileByPath(attachedFile.pathname);
		let path = file?.path ?? "";
		if (!file) path = AssetHandler.mediaPath.joinString(attachedFile.fullName).path;
		const data: Buffer | undefined = await attachedFile.readAsBuffer();

		if (!data) return;

		const target = new Path(path, this.destination.path)
							.slugify(this.exportOptions.slugifyPaths);

		const attachment = new Attachment(data, target, file, this.exportOptions);
		if (!attachment.sourcePath) attachment.sourcePath = attachedFile.pathname;
		return attachment;
	}

	public getFilePathFromSrc(src: string, exportingFilePath: string): Path
	{
		// @ts-ignore
		let pathString = "";
		if (src.startsWith("app://"))
		{
			let fail = false;
			try
			{
				// @ts-ignore
				pathString = app.vault.resolveFileUrl(src)?.path ?? "";
				if (pathString == "") fail = true;
			}
			catch
			{
				fail = true;
			}

			if(fail)
			{
				pathString = src.replaceAll("app://", "").replaceAll("\\", "/");
				pathString = pathString.replaceAll(pathString.split("/")[0] + "/", "");
				pathString = Path.getRelativePathFromVault(new Path(pathString), true).path;
				ExportLog.log(pathString, "Fallback path parsing:");
			}
		}
		else
		{
			const split = src.split("#");

			const hash = split[1]?.trim();
			const path = split[0];
			pathString = app.metadataCache.getFirstLinkpathDest(path, exportingFilePath)?.path ?? "";
			if (hash) 
			{
				pathString += "#" + hash;
			}
		}

		pathString = pathString ?? "";

		return new Path(pathString);
	}

	public async getCombinedHTML(): Promise<string>
	{
		// get index.html
		let index = this.index.webpages.find((file) => file.filename == "index.html");
		if (!index?.data && this.index.webpages.length > 0)
		{
			ExportLog.warning("No index.html found, using the first webpage");
			index = this.index.webpages[0];
		}

		if (!index?.data)
		{
			ExportLog.error("No index.html found, website creation failed");
			return "";
		}

		let html = new DOMParser().parseFromString(index.data as string, "text/html");

		// define metadata
		let metadataScript = html.head.createEl("data");
		metadataScript.id = "website-metadata";

		const fileInfo = this.index.websiteData.fileInfo;
		const webpages = this.index.websiteData.webpages;
		// @ts-ignore
		delete this.index.websiteData.fileInfo;
		// @ts-ignore
		delete this.index.websiteData.webpages;
		metadataScript.setAttribute("value", encodeURI(JSON.stringify(this.index.websiteData)));

		// create a data element with the id being the file path for each file
		for (const [path, data] of Object.entries(webpages))
		{
			const dataElement = html.head.createEl("data");
			dataElement.id = encodeURI(path);
			dataElement.setAttribute("value", encodeURI(JSON.stringify(data)));
		}

		// do the same for file info skipping already existing elements
		for (const [path, data] of Object.entries(fileInfo))
		{
			if (html.getElementById(encodeURI(path))) continue;
			const dataElement = html.head.createEl("data");
			dataElement.id = encodeURI(path);
			dataElement.setAttribute("value", encodeURI(JSON.stringify(data)));
		}

		


		return `<!DOCTYPE html>\n${html.documentElement.outerHTML}`;
	}

	public async saveAsCombinedHTML(): Promise<void>
	{
		const html = await this.getCombinedHTML();
		const path = this.destination.joinString(this.exportOptions.siteName + ".html");
		await path.write(html);
	}
}

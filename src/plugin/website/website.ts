import { Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import { Path } from "plugin/utils/path";
import { WebsiteData } from "shared/website-data";
import { ExportPipelineOptions } from "./pipeline-options";
import { Settings } from "plugin/settings/settings";
import { AssetHandler } from "plugin/asset-loaders/asset-handler";
import { HTMLGeneration } from "plugin/render-api/html-generation-helpers";
import HTMLExportPlugin from "plugin/main";
import { Attachment } from "plugin/utils/downloadable";
import { AssetLoader } from "plugin/asset-loaders/base-asset";
import { AssetType } from "plugin/asset-loaders/asset-types";
import { IconHandler } from "plugin/utils/icon-handler";
import { Webpage } from "./webpage";
import { MarkdownRendererAPI } from "plugin/render-api/render-api";
import { WebpageTemplate } from "./webpage-template";
import { TemplateInsert } from "shared/features/feature-options-base";
import { ThemeToggle } from "plugin/features/theme-toggle";
import { SearchInput } from "plugin/features/search-input";
import { GraphView } from "plugin/features/graph-view";
import { FileTree } from "plugin/features/file-tree";
import { Utils } from "plugin/utils/utils";
import { create } from "domain";
import { Shared } from "shared/shared";
import { Index } from ".";


export class Website
{
	public options: ExportPipelineOptions;
	private loadedMetadata: WebsiteData;
	public metadata: WebsiteData;
	private files: TFile[];
	private sourceRootPath: Path;
	public targetPath: Path;
	private metadataPath: Path;
	private webpages: Webpage[] = [];
	private attachments: Attachment[] = [];
	public pageTemplate: WebpageTemplate;
	public searchIndex: Index = new Index();
	private customFeatureCallback: ((website: Website) => TemplateInsert[]) | undefined;

	constructor(targetPath: Path, customFeatureCallback?: (website: Website) => TemplateInsert[])
	{
		this.targetPath = targetPath;
		this.customFeatureCallback = customFeatureCallback;
	}

	public async load(files?: TFile[])
	{
		// filter undefined files
		files = files?.filter((file) => file) ?? [];
		this.files = files ?? app.vault.getFiles();
		this.options = Object.assign(new ExportPipelineOptions(), Settings.exportOptions);
		this.options.filesToExport = this.files.map((file) => file.path);
		this.metadataPath = this.targetPath.join(AssetHandler.libraryPath).joinString(Shared.metadataFileName);
		this.sourceRootPath = this.getBasePathForFiles(this.files);
		this.options.exportRoot = this.sourceRootPath.slugified(this.options.slugifyPaths).path + "/";
		
		this.searchIndex.load(this);

		await this.initMetadata();
		await this.initWebpages();
		console.log(this);
		return this;
	}

	public async build()
	{
		await AssetHandler.reloadAssets(this.options);

		// create webpage template
		this.pageTemplate = new WebpageTemplate(this.options);
		// insert features
		const features = await this.getFeatures();
		for (const feature of features)
		{
			this.pageTemplate.insertFeature(feature);
		}

		// start render batch
		await MarkdownRendererAPI.beginBatch(this.options);

		// render webpages
		let newAttachmentPaths: string[] = []
		for (const webpage of this.webpages)
		{
			try
			{
				await webpage.build();
				await this.searchIndex.indexPage(webpage);
				await webpage.save();
				newAttachmentPaths.push(...webpage.attachmentSourcePaths);
			}
			catch (error)
			{
				console.error("Error rendering webpage: " + webpage.source.path, error);
			}
			finally
			{
				webpage.dispose();
			}
		}

		// create attachments
		for (const attachment of newAttachmentPaths)
		{
			const file = app.vault.getFileByPath(attachment);

			if (file)
			{
				const attachment = await this.createAttachment(file);
				this.attachments.push(attachment);
			}
		}

		MarkdownRendererAPI.endBatch();

		await this.saveAttachments();
		await this.saveMetadata();
		await this.searchIndex.saveIndex();

		await Utils.downloadAttachments(AssetHandler.getDownloads(this.targetPath, this.options));
		console.log("Website built: ", this);
		return this;
	}

	private async getFeatures(): Promise<TemplateInsert[]>
	{
		const features: TemplateInsert[] = [];

		if (this.options.graphViewOptions.enabled)
		{
			const graphView = await new GraphView().generate();
			features.push(new TemplateInsert(graphView, this.options.graphViewOptions));
		}

		if (this.options.themeToggleOptions.enabled)
		{
			const themeToggle = await new ThemeToggle().generate();
			features.push(new TemplateInsert(themeToggle, this.options.themeToggleOptions));
		}

		if (this.options.searchOptions.enabled)
		{
			const searchInput = await new SearchInput().generate();
			features.push(new TemplateInsert(searchInput, this.options.searchOptions));
		}

		if (this.options.fileNavigationOptions.enabled)
		{
			const paths = this.webpages.filter((page) => page.metadata.showInTree).sort((a, b) => a.metadata.treeOrder - b.metadata.treeOrder).map((page) => page.templatePath);
			const fileTree = new FileTree(paths, false, true);
			fileTree.makeLinksWebStyle = this.options.slugifyPaths ?? true;
			fileTree.showNestingIndicator = true;
			fileTree.generateWithItemsClosed = true;
			fileTree.showFileExtentionTags = true;
			fileTree.hideFileExtentionTags = ["md"];
			fileTree.title = this.options.siteName ?? app.vault.getName();
			fileTree.id = "file-explorer";
			const tempContainer = document.createElement("div");
			const fileTreeEl = await fileTree.generate(tempContainer);
			features.push(new TemplateInsert(fileTreeEl, this.options.fileNavigationOptions));
		}

		// insert custom features
		if (this.customFeatureCallback)
		{
			const customFeatures = this.customFeatureCallback(this);
			if (customFeatures && customFeatures.length > 0)
			{
				features.push(...customFeatures);
			}
		}

		return features;
	}

	private async loadMetadata(): Promise<WebsiteData | undefined>
	{
		const loadedMetadata = await this.metadataPath.readAsString();
		if (loadedMetadata)
		{
			let parsed = JSON.parse(loadedMetadata);

			//remove properties not present in the WebsiteData interface
			let example = new WebsiteData();
			for (const key in parsed)
			{
				if (!(key in example)) delete parsed[key];
			}

			return parsed as WebsiteData;
		}

		return undefined;
	}

	private async initMetadata()
	{
		const loaded = await this.loadMetadata();
		if (loaded)
		{
			this.loadedMetadata = loaded;
			this.metadata = JSON.parse(JSON.stringify(loaded)) as WebsiteData; // clone
		}
		else // create new metadata and first init
		{
			this.metadata = new WebsiteData();
			this.metadata.createdTime = Date.now();
		}
		
		this.metadata.siteName = this.options.siteName;
		this.metadata.vaultName = app.vault.getName();
		this.metadata.modifiedTime = Date.now();
		this.metadata.sourceToTarget = {};
		this.metadata.targetToSource = {};
		this.metadata.allFiles = [];

		for (const file of this.files)
		{
			const filename = new Path(file.path).setExtension("html").fullName;
			this.getTargetFilePath(file.path, filename);
		}

		this.metadata.exportRoot = this.options.exportRoot;
		this.metadata.baseURL = this.options.siteURL;
		this.metadata.bodyClasses = await HTMLGeneration.getValidBodyClasses(true);
		this.metadata.featureOptions = this.options.getFeatureOptions();
		this.metadata.hasFavicon = this.options.faviconPath != "";
		this.metadata.pluginVersion = HTMLExportPlugin.pluginVersion;
	}

	private async saveMetadata()
	{
		await this.metadataPath.write(JSON.stringify(this.metadata, null, 0));
	}

	private async saveAttachments()
	{
		for (const attachment of this.attachments)
		{
			await attachment.download();
		}
	}

	private async initWebpages()
	{
		const attachmentFiles = this.files.filter((file) => !MarkdownRendererAPI.isConvertable(file.extension) || MarkdownRendererAPI.viewableMediaExtensions.contains(file.extension));

		this.webpages = await Promise.all(this.files.map(async (file) => await new Webpage(this, file).load()));
		this.attachments = await Promise.all(attachmentFiles.map(async (file) => await this.createAttachment(file)));
	}

	private async createAttachment(file: TFile)
	{
		const data = Buffer.from(await app.vault.readBinary(file));
		const path = this.getTargetFilePath(file.path, undefined, true);
		console.log("Creating attachment: ", path.path);
		let attachment = new Attachment(data, path, file, this.options);
		attachment.showInTree = true;
		return attachment;
	}

	private getBasePathForFiles(files: TFile[]): Path
	{
		if (files.length > 1)
		{ 
			let commonPath = "";
			let paths = files.map((file) => file.path.split("/"));
			while (paths.every((path) => path[0] == paths[0][0]))
			{
				commonPath += paths[0][0] + "/";
				paths = paths.map((path) => path.slice(1));
				
				const anyEmpty = paths.some((path) => path.length == 1);
				if (anyEmpty) break;
			}
			console.log("Export root path: " + commonPath);
			return new Path(commonPath);
		}
		else return new Path(files[0].parent?.path ?? "");
	}

	public hasFile(path: string): boolean
	{
		return this.metadata.targetToSource[path] != undefined || this.metadata.sourceToTarget[path] != undefined;
	}

	public getTargetFilePath(sourcePath: string, filename?: string, bypassCache: boolean = false): Path
	{
		if (!bypassCache && this.metadata.sourceToTarget[sourcePath]) return new Path(this.metadata.sourceToTarget[sourcePath]).setWorkingDirectory(this.targetPath.path);

		const targetPath = new Path(sourcePath);
		if (filename) targetPath.fullName = filename;
		targetPath.setWorkingDirectory((this.targetPath?.joinString(this.options.exportRoot) ?? Path.vaultPath.joinString("Web Export")).path);
		targetPath.slugify(this.options.slugifyPaths);
		if (targetPath.path.startsWith(this.options.exportRoot)) targetPath.reparse(targetPath.path.substring(this.options.exportRoot.length));

		if (!bypassCache)
			this.metadata.sourceToTarget[sourcePath] = targetPath.path;

		this.metadata.targetToSource[targetPath.path] = sourcePath;
		this.metadata.allFiles.push(targetPath.path);

		return targetPath;
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

}

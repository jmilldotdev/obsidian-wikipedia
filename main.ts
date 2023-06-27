import {
  App,
  Editor,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  request,
  RequestParam,
  Setting,
  TextComponent,
} from "obsidian";
import { parse } from "node-html-parser";
import TurndownService from "turndown";

interface WikipediaExtract {
  title: string;
  text: string;
  url: string;
}

interface WikipediaPluginSettings {
  template: string;
  shouldUseParagraphTemplate: boolean;
  shouldBoldSearchTerm: boolean;
  paragraphTemplate: string;
  language: string;
  fetchMarkdown: boolean;
}

const DEFAULT_SETTINGS: WikipediaPluginSettings = {
  template: `{{text}}\n> [Wikipedia]({{url}})`,
  shouldUseParagraphTemplate: true,
  shouldBoldSearchTerm: true,
  paragraphTemplate: `> {{paragraphText}}\n>\n`,
  language: "en",
  fetchMarkdown: false,
};

const extractApiUrl =
  "wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&redirects&origin=*&titles=";

const disambiguationIdentifier = "may refer to:";

async function extractWikiMarkdown(language: string, query: string): Promise<string> {
  const acceptLanguage = language == 'zh' ? 'zh-cn' : undefined
  const res = await request({
    url: `https://${language}.wikipedia.org/wiki/${query}`,
    headers: {
      'Accept-Language': acceptLanguage
    }
  })

  const parsedDocument = parse(res);
  const content = parsedDocument.querySelector('div[id=mw-content-text]')
  content.querySelector('div[class~=navigation-not-searchable]')?.remove()
  content.querySelector('table[class~=box-Unreferenced]')?.remove()
  content.querySelector('table[class~=infobox]')?.remove()
  content.querySelector('table[role=presentation]')?.remove()
  content.querySelectorAll('span[class~=mw-editsection]')?.forEach(v => v.remove())
  content.querySelectorAll('noscript')?.forEach(v => v.remove())
  content.querySelectorAll('sup[class~=reference]')?.forEach(v => v.remove())
  content.querySelector('div[class=printfooter]')?.remove()
  try {
    while (true) {
      content.querySelector('div[id=toc]').nextElementSibling.remove()
    }
  } catch (e) {

  }
  content.querySelector('div[id=toc]')?.remove()


  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```'
  });
  let txt = turndownService.turndown(content.innerHTML);

  txt = txt.replace(/\(\/\/upload.wikimedia.org/g, '(https://upload.wikimedia.org')
  txt = txt.replace(/\(\//g, `(https://${language}.wikipedia.org/`)
  return txt
}

export default class WikipediaPlugin extends Plugin {
  settings: WikipediaPluginSettings;

  getLanguage(): string {
    return this.settings.language ? this.settings.language : "en";
  }

  getUrl(title: string): string {
    return `https://${this.getLanguage()}.wikipedia.org/wiki/${encodeURI(
      title
    )}`;
  }

  getApiUrl(): string {
    return `https://${this.getLanguage()}.` + extractApiUrl;
  }

  formatExtractText(extract: WikipediaExtract, searchTerm: string): string {
    const text = extract.text;
    let formattedText: string = "";
    if (this.settings.shouldUseParagraphTemplate) {
      const split = text.split("==")[0].trim().split("\n");
      formattedText = split
        .map((paragraph) =>
          this.settings.paragraphTemplate.replace(
            "{{paragraphText}}",
            paragraph
          )
        )
        .join("")
        .trim();
    } else {
      formattedText = text.split("==")[0].trim();
    }
    if (this.settings.shouldBoldSearchTerm) {
      const pattern = new RegExp(searchTerm, "i");
      formattedText = formattedText.replace(pattern, `**${searchTerm}**`);
    }
    return formattedText;
  }

  handleNotFound(searchTerm: string) {
    new Notice(`${searchTerm} not found on Wikipedia.`);
  }

  handleCouldntResolveDisambiguation() {
    new Notice(`Could not automatically resolve disambiguation.`);
  }

  hasDisambiguation(extract: WikipediaExtract) {
    if (extract.text.includes(disambiguationIdentifier)) {
      return true;
    }
    return false;
  }

  parseResponse(json: any): WikipediaExtract | undefined {
    const pages = json.query.pages;
    const pageKeys = Object.keys(pages);
    if (pageKeys.includes("-1")) {
      return undefined;
    }
    const extracts: WikipediaExtract[] = pageKeys.map((key) => {
      const page = pages[key];
      const extract: WikipediaExtract = {
        title: page.title,
        text: page.extract,
        url: this.getUrl(page.title),
      };
      return extract;
    });
    return extracts[0];
  }

  formatExtractInsert(extract: WikipediaExtract, searchTerm: string): string {
    const formattedText = this.formatExtractText(extract, searchTerm);
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{searchTerm}}", searchTerm)
      .replace("{{url}}", extract.url);
    return formattedTemplate;
  }

  async getWikipediaText(title: string): Promise<WikipediaExtract | undefined> {
    const url = this.getApiUrl() + encodeURIComponent(title);
    const requestParam: RequestParam = {
      url: url,
    };
    const resp = await request(requestParam)
      .then((r) => JSON.parse(r))
      .catch(
        () =>
          new Notice(
            "Failed to get Wikipedia. Check your internet connection or language prefix."
          )
      );
    const extract = this.parseResponse(resp);
    if (this.settings.fetchMarkdown) {
      extract.text = await extractWikiMarkdown(this.getLanguage(), title)
    }
    return extract;
  }

  async pasteIntoEditor(editor: Editor, searchTerm: string) {
    let extract: WikipediaExtract = await this.getWikipediaText(searchTerm);
    if (!extract) {
      this.handleNotFound(searchTerm);
      return;
    }
    if (this.hasDisambiguation(extract)) {
      new Notice(
        `Disambiguation found for ${searchTerm}. Choosing first result.`
      );
      const newSearchTerm = extract.text
        .split(disambiguationIdentifier)[1]
        .trim()
        .split(",")[0]
        .split("==")
        .pop()
        .trim();
      extract = await this.getWikipediaText(newSearchTerm);
      if (!extract) {
        this.handleCouldntResolveDisambiguation();
        return;
      }
    }
    editor.replaceSelection(this.formatExtractInsert(extract, searchTerm));
  }

  async getWikipediaTextForActiveFile(editor: Editor) {
    const activeFile = await this.app.workspace.getActiveFile();
    if (activeFile) {
      const searchTerm = activeFile.basename;
      if (searchTerm) {
        await this.pasteIntoEditor(editor, searchTerm);
      }
    }
  }

  async getWikipediaTextForSearchTerm(editor: Editor) {
    new WikipediaSearchModal(this.app, this, editor).open();
  }

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "wikipedia-get-active-note-title",
      name: "Get Wikipedia for Active Note Title",
      editorCallback: (editor: Editor) =>
        this.getWikipediaTextForActiveFile(editor),
    });

    this.addCommand({
      id: "wikipedia-get-search-term",
      name: "Get Wikipedia for Search Term",
      editorCallback: (editor: Editor) =>
        this.getWikipediaTextForSearchTerm(editor),
    });

    this.addSettingTab(new WikipediaSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class WikipediaSearchModal extends Modal {
  searchTerm: string;
  plugin: WikipediaPlugin;
  editor: Editor;

  constructor(app: App, plugin: WikipediaPlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
  }

  onOpen() {
    let { contentEl } = this;

    contentEl.createEl("h2", { text: "Enter Search Term:" });

    const inputs = contentEl.createDiv("inputs");
    const searchInput = new TextComponent(inputs).onChange((searchTerm) => {
      this.searchTerm = searchTerm;
    });
    searchInput.inputEl.focus();
    searchInput.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.close();
      }
    });

    const controls = contentEl.createDiv("controls");
    const searchButton = controls.createEl("button", {
      text: "Search",
      cls: "mod-cta",
      attr: {
        autofocus: true,
      },
    });
    searchButton.addEventListener("click", this.close.bind(this));
    const cancelButton = controls.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", this.close.bind(this));
  }

  async onClose() {
    let { contentEl } = this;

    contentEl.empty();
    if (this.searchTerm) {
      await this.plugin.pasteIntoEditor(this.editor, this.searchTerm);
    }
  }
}

class WikipediaSettingTab extends PluginSettingTab {
  plugin: WikipediaPlugin;

  constructor(app: App, plugin: WikipediaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Wikipedia" });

    new Setting(containerEl)
      .setName("Wikipedia Language Prefix")
      .setDesc(`Choose Wikipedia language prefix to use (ex. en for English)`)
      .addText((textField) => {
        textField
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Wikipedia Extract Template")
      .setDesc(
        `Set markdown template for extract to be inserted.\n
        Available template variables are {{text}}, {{searchTerm}} and {{url}}.
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.template)
          .onChange(async (value) => {
            this.plugin.settings.template = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bold Search Term?")
      .setDesc(
        "If set to true, the first instance of the search term will be **bolded**"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shouldBoldSearchTerm)
          .onChange(async (value) => {
            this.plugin.settings.shouldBoldSearchTerm = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Use paragraph template?")
      .setDesc(
        "If set to true, the paragraph template will be inserted for each paragraph of text for {{text}} in main template."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shouldUseParagraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.shouldUseParagraphTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Paragraph Template")
      .setDesc(
        `Set markdown template for extract paragraphs to be inserted.\n
        Available template variables are: {{paragraphText}}
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.paragraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.paragraphTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Fetch Wiki as Markdown?")
      .setDesc(
        "If set to true, the wiki content will be fetched as markdown."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.fetchMarkdown)
          .onChange(async (value) => {
            this.plugin.settings.fetchMarkdown = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

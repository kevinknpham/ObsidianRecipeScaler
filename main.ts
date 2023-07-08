/*
TODO:
add plural forms of units
*/

import { App, Editor, MarkdownRenderChild, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

const SCALE_FACTOR_PATTERN = /^(x|\/)\d+$/;
const SCALABLE_QUANTITY_PATTERN = /^((\d+((\.\d+)|( \d+\/\d+))?)|(\d+\/\d+))( [a-zA-Z ]+)?$/;

interface RecipeScalerSettings {
	defaultScaleFactor: string;
}

const DEFAULT_SETTINGS: RecipeScalerSettings = {
	defaultScaleFactor: 'x1'
}

export default class RecipeScaler extends Plugin {
	settings: RecipeScalerSettings;

	async onload() {
		await this.loadSettings();

		const scaleFactor = this.getScaleFactorFromString(this.settings.defaultScaleFactor);

		// this.registerMarkdownCodeBlockProcessor('recipeconfig', (source, el, context) => {
		// 	try {
		// 		const overrideConfigs = JSON.parse(source);
				
		// 		scaleFactor = this.getScaleFactorFromString(overrideConfigs['scale']);

		// 		el.createEl('p', {text: `ScaleFactor: ${overrideConfigs['scale']}`});
		// 	} catch (e) {
		// 		// Do nothing
		// 		console.log(e);
		// 	}
		// }, 0);

		// this.registerMarkdownPostProcessor((element, context) => {
		// 	const configOverrideBlock = element.querySelector('.language-json');

		// 	if (configOverrideBlock) {
		// 		console.log(configOverrideBlock);
		// 		const configOverrideCode = configOverrideBlock.querySelector('code');
		// 		if (configOverrideCode) {
		// 			let configOverride;
		// 			try {
		// 				configOverride = JSON.parse(configOverrideCode.innerHTML);
		// 			} catch (e) {
		// 				return;
		// 			}
		// 			context
		// 		}
		// 	}

		// 	console.log(configOverrideBlock ? configOverrideBlock.innerText : 'whoops');
		// }, 0);

		this.registerMarkdownPostProcessor((element, context) => {
			console.log(`scalefactor is ${scaleFactor}`);

			const codeblocks = element.querySelectorAll("code");

      for (let index = 0; index < codeblocks.length; index++) {
        const codeblock = codeblocks.item(index);
        const text = codeblock.innerText.trim();

        if (SCALABLE_QUANTITY_PATTERN.test(text)) {
					context.addChild(new ScaledQuantity(codeblock, text, scaleFactor))
        }
      }

    }, 1);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ScalingSettingsTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}
	
	getScaleFactorFromString(rawScaleFactor : string) : number {
		if (rawScaleFactor[0] === 'x') {
			return +rawScaleFactor.substring(1);
		} else if (rawScaleFactor[1] === '/') {
			return 1 / (+rawScaleFactor.substring(1));
		} else {
			throw new Error("Invalid scale factor");
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ScalingSettingsTab extends PluginSettingTab {
	plugin: RecipeScaler;

	constructor(app: App, plugin: RecipeScaler) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for Recipe Scaler.'});

		new Setting(containerEl)
      .setName("Default scale factor")
      .setDesc("Factor by which to scale recipes by default.  Should be x or / followed by an integer.")
      .addText((text) =>
        text
          .setPlaceholder("x1")
          .setValue(this.plugin.settings.defaultScaleFactor)
          .onChange(async (value) => {
						if (SCALE_FACTOR_PATTERN.test(value)) {
							this.plugin.settings.defaultScaleFactor = value;
							await this.plugin.saveSettings();
						}
          })
      );

	}
}

interface UnitConversion {
	from : string,
	to : string,
	multiplier : number 
}

class ScaledQuantity extends MarkdownRenderChild {
	static VOLUME_UNITS_IN_TSP : Record<string, number> = {
		tsp: 1,
		tbsp: 3,
		cup: 3 * 16,
		gallon: 3 * 16 * 16
	};

	static MASS_UNITS_IN_GRAMS : Record<string, number> = {
		g: 1,
		kg: 1000
	}

	static ALT_NAMES : Record<string, string> = {
		teaspoon: 'tsp',
		teaspoons: 'tsp',
		tablespoon: 'tbsp',
		tablespoons: 'tbsp',
		cups: 'cup',
		gallons: 'gallon',
		gram: 'g',
		grams: 'g',
		kilogram: 'kg',
		kilograms: 'kg'
	}

	static PLURAL_FORMS : Record<string, string> = {
		tsp: 'tsp',
		tbsp: 'tbsp',
		g: 'g',
		kg: 'kg'
	}

	text: string;
	scaleFactor: number;

	constructor(containerEl: HTMLElement, text: string, scaleFactor: number) {
		super(containerEl);

		this.text = text;
		this.scaleFactor = scaleFactor;
	}

	onload(): void {
		let newTextEl;
		if (/^\d+(\.\d+)?( [a-zA-Z ]+)?$/g.test(this.text)) {
			newTextEl = this.handleDecimal();
		} else {
			newTextEl = this.handleMixedNumber();
		}
		this.containerEl.replaceWith(newTextEl);
	}

	handleDecimal() : HTMLElement {
		const spaceIndex = this.text.indexOf(' ');
		const amount = spaceIndex == -1 ? +this.text : +this.text.substring(0, spaceIndex);
		const unit = spaceIndex == -1 ? '' : this.text.substring(spaceIndex + 1);

		const scaledAmount = amount * this.scaleFactor;
		const unitAliased = ScaledQuantity.ALT_NAMES[unit] ?? unit;

		let finalUnit = unit;
		let finalAmount = scaledAmount;
		const unitConversion = this.getDesiredUnit(scaledAmount, unitAliased) ?? unit;
		if (unitConversion.to !== unitAliased) {
			finalUnit = unitConversion.to;
			finalAmount *= unitConversion.multiplier;
		}

		const finalText = this.roundToTwo(finalAmount) + (finalUnit.length == 0 ? '' : ` ${finalUnit}`);

		return this.containerEl.createSpan({text : finalText});
	}
	
	handleMixedNumber() : HTMLElement {
		let amountWhole = 0;
		let fractionString = '';
		let unit = '';
		if (/^\d+ \d+\/\d+?( [a-zA-Z ]+)?$/.test(this.text)) {
			const firstSpaceIndex = this.text.indexOf(' ');
			const secondSpaceIndex = this.text.indexOf(' ', firstSpaceIndex + 1);

			amountWhole = +this.text.substring(0, firstSpaceIndex);
			fractionString = secondSpaceIndex == -1 ? this.text.substring(firstSpaceIndex + 1) : this.text.substring(firstSpaceIndex + 1, secondSpaceIndex);
			unit = secondSpaceIndex == -1 ? '' : this.text.substring(secondSpaceIndex + 1);
		} else {
			const spaceIndex = this.text.indexOf(' ');
			fractionString = spaceIndex == -1 ? this.text : this.text.substring(0, spaceIndex);
			unit = spaceIndex == -1 ? '' : this.text.substring(spaceIndex + 1);
		}

		const [numerator, denominator] : number[] = fractionString.split('/').map(el => +el);

		const currTotalFractionNumerator : number = amountWhole * denominator + numerator;
		const scaledNumerator = currTotalFractionNumerator * this.scaleFactor;

		const unitAliased = ScaledQuantity.ALT_NAMES[unit] ?? unit;

		let finalUnit = unit;
		let convertedNumerator = scaledNumerator;
		const unitConversion = this.getDesiredUnit(scaledNumerator / denominator, unitAliased) ?? unit;
		if (unitConversion.to !== unitAliased) {
			finalUnit = unitConversion.to;
			convertedNumerator *= unitConversion.multiplier;
		}

		const [finalNumerator, finalDenominator] : number[] = this.reduceFraction(convertedNumerator, denominator);

		let finalAmountText;
		if (finalDenominator === 1) {
			finalAmountText = finalNumerator;
		} else {
			const finalAmountTextWholePortion = Math.floor(finalNumerator / finalDenominator);
			if (finalAmountTextWholePortion === 0) {
				finalAmountText = `${finalNumerator % finalDenominator}/${finalDenominator}`;
			} else {
				finalAmountText = `${finalAmountTextWholePortion} ${finalNumerator % finalDenominator}/${finalDenominator}`;
			}
		}
		const finalText = finalAmountText + (finalUnit.length == 0 ? '' : ` ${finalUnit}`);

		return this.containerEl.createSpan({text : finalText});
	}

	reduceFraction(origNumerator : number, origDenominator : number) : number[] {
		const getGCD = function(n : number, d : number) : number {
			let numerator = (n<d)?n:d;
			let denominator = (n<d)?d:n;        
			let remainder = numerator;
			let lastRemainder = numerator;

			while (true){
				lastRemainder = remainder;
				remainder = denominator % numerator;
				if (remainder === 0){
					break;
				}
				denominator = numerator;
				numerator = remainder;
			}
			if(lastRemainder){
				return lastRemainder;
			}
			return 0;
		};

		const gcd = getGCD(origNumerator, origDenominator);

		return [origNumerator / gcd, origDenominator / gcd];
	}

	roundToTwo(num : number) : number {
    return +(Math.round(+(num + "e+2"))  + "e-2");
	}

	getDesiredUnit(amount : number, currentUnit : string) : UnitConversion {
		if (ScaledQuantity.VOLUME_UNITS_IN_TSP[currentUnit]) {
			const amountInTsp = ScaledQuantity.VOLUME_UNITS_IN_TSP[currentUnit] * amount;

			const entries = Object.entries(ScaledQuantity.VOLUME_UNITS_IN_TSP)
					.sort((a,b) => b[1] - a[1]);
			for (let i = 0; i < entries.length; i++) {
				const [unit, tspInUnit] = entries[i];
				if (amountInTsp / tspInUnit >= 1) {
					return {from: currentUnit, to: unit, multiplier: ScaledQuantity.VOLUME_UNITS_IN_TSP[currentUnit] / tspInUnit};
				}
			}
			return {from: currentUnit, to: 'tsp', multiplier: ScaledQuantity.VOLUME_UNITS_IN_TSP[currentUnit]};
		}

		if (ScaledQuantity.MASS_UNITS_IN_GRAMS[currentUnit]) {
			const amountInGrams = ScaledQuantity.MASS_UNITS_IN_GRAMS[currentUnit] * amount;

			const entries = Object.entries(ScaledQuantity.MASS_UNITS_IN_GRAMS)
					.sort((a,b) => b[1] - a[1]);
			for (let i = 0; i < entries.length; i++) {
				const [unit, gramsInUnit] = entries[i];
				if (amountInGrams / gramsInUnit > 1) {
					return {from: currentUnit, to: unit, multiplier: ScaledQuantity.MASS_UNITS_IN_GRAMS[currentUnit] / gramsInUnit};
				}
			}
			return {from: currentUnit, to: 'g', multiplier: ScaledQuantity.MASS_UNITS_IN_GRAMS[currentUnit]};
		}

		return {from: currentUnit, to: currentUnit, multiplier: 1};
	}
}
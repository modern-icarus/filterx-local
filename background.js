
const LANGUAGE_DETECTION_MODEL = "http://127.0.0.1:8000/predict-language";
const ENGLISH_HATE_SPEECH_MODEL = "http://127.0.0.1:8000/predict-english";
const TAGALOG_HATE_SPEECH_MODEL = "http://127.0.0.1:8000/predict-tagalog";

var hateSpeechMap = {};

// Log levels: 0 = no logs, 1 = error, 2 = warn, 3 = info, 4 = debug
let logLevel = 3;

// Logging utility function
function log(level, message, ...optionalParams) {
    if (level <= logLevel) {
        switch (level) {
            case 1:
                console.error(message, ...optionalParams);
                break;
            case 2:
                console.warn(message, ...optionalParams);
                break;
            case 3:
                console.info(message, ...optionalParams);
                break;
            case 4:
                console.debug(message, ...optionalParams);
                break;
        }
    }
}

// Global variable to store real-time toggle state
let isRealTimeEnabled = false;

// Function to set real-time toggle state and apply it to all open tabs
function setRealTimeEnabled(enabled) {
    isRealTimeEnabled = enabled;

    // Apply real-time mode to all currently open tabs
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
            if (tab.url && !tab.url.startsWith("chrome://")) {  // Skip restricted URLs
                chrome.tabs.sendMessage(tab.id, { action: "toggleObserver", enabled: isRealTimeEnabled }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Failed to send message to tab:", chrome.runtime.lastError.message);
                    }
                });
            }
        });
    });
}

// Listen for new tabs and apply real-time mode if enabled
chrome.tabs.onCreated.addListener((tab) => {
    if (isRealTimeEnabled) {
        // Check if the tab's URL is accessible
        if (tab.url && !tab.url.startsWith("chrome://")) {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content.js"]
            }, () => {
                // After injecting the content script, send the toggle message
                chrome.tabs.sendMessage(tab.id, { action: "toggleObserver", enabled: true }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Failed to send message to new tab:", chrome.runtime.lastError.message);
                    }
                });
            });
        }
    }
});

// Listen for updates to tabs (URL changes) and apply real-time mode if enabled
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only proceed if the URL has fully loaded and is accessible
    if (changeInfo.status === 'complete' && isRealTimeEnabled && tab.url && !tab.url.startsWith("chrome://")) {
        // Inject content script and apply real-time detection
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
        }, () => {
            chrome.tabs.sendMessage(tab.id, { action: "toggleObserver", enabled: true }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Failed to send message to updated tab:", chrome.runtime.lastError.message);
                }
            });
        });
    }
});

// Listen for toggle messages from the UI to update real-time mode
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "setRealTimeToggle") {
        setRealTimeEnabled(message.enabled);
        sendResponse({ status: "success" });
    }
});




async function callAPI(url, sentence) {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: sentence }), // Adjust if your API expects different request structure
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("API response:", result);

        return result;
    } catch (error) {
        console.error("API request failed: ", error.message);
        throw error;
    }
}


async function detectLanguage(sentence) {
    const result = await callAPI(LANGUAGE_DETECTION_MODEL, sentence);

    const predictions = result;

    // Log the full response to verify language predictions
    console.log("Language detection response:", result);
    console.log("Predictions array:", predictions);

    let language = "english"; // Default to 'english' if no specific language is detected

    if (predictions && predictions.length > 0) {
        // Log each prediction to see what scores are being processed
        predictions.forEach(pred => {
            console.log(`Label: ${pred.label}, Score: ${pred.score}`);
        });

        // Check if any Filipino language label has a score above the threshold
        const isFilipinoLanguage = predictions.some(pred => 
            (pred.label === "tgl_Latn" && pred.score > 0.5) || 
            (pred.label === "ceb_Latn" && pred.score > 0.5) || 
            (pred.label === "war_Latn" && pred.score > 0.5)
        );

        // Check if English is detected with a high enough score
        const isEnglish = predictions.some(pred => pred.label === "eng_Latn" && pred.score > 0.1);

        if (isFilipinoLanguage) {
            console.log("Detected as Tagalog language due to high score in Filipino language labels.");
            language = "tagalog";
        } else if (isEnglish) {
            console.log("Detected as English language due to high score in English label.");
            language = "english";
        } else {
            console.log("Detected as unspecified language with low confidence.");
        }
    } else {
        console.log("No valid predictions found in response.");
    }

    log(3, `Sentence: "${sentence}"`, `Language Prediction: ${language}`);

    return language;
}


// Group sentences by detected language
async function groupByLanguage(sentences) {
    const englishGroup = [];
    const tagalogGroup = [];

    // Create and immediately execute the async tasks
    await Promise.all(sentences.map(async (sentence) => {
        const language = await detectLanguage(sentence);
        if (language === "english") {
            englishGroup.push(sentence);
        } else {
            tagalogGroup.push(sentence);
        }
    }));

    console.log(englishGroup, tagalogGroup); // This will now show the populated arrays
    return { englishGroup, tagalogGroup };
}


let currentMode = 'moderate'; // Default to 'free' mode if nothing is set

// Listener for receiving mode changes from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'setMode') {
        currentMode = message.mode;
        console.log(`Mode changed to: ${currentMode}`);
    }
});

function getModeThreshold() {
    let threshold;

    switch (currentMode) {
        case 'strict':
            threshold = 0.6;
            break;
        case 'moderate':
            threshold = 0.8;
            break;
        case 'free':
        default:
            threshold = 0.9;
            break;
    }
    return threshold;
}

async function callHateSpeechAPI(model, sentence) {
    const prediction = await callAPI(model, sentence);

    const threshold = getModeThreshold();
    log(3, `Sentence: "${sentence}"`, `Where API was sent: ${model}`, `API Prediction: ${JSON.stringify(prediction)}`, `Mode Threshold: ${threshold}`);

    const flagged = prediction.filter(pred => 
        (model === ENGLISH_HATE_SPEECH_MODEL && pred.label === "HATE" && pred.score >= threshold) ||
        (model === TAGALOG_HATE_SPEECH_MODEL && pred.label === "LABEL_1" && pred.score >= threshold)
    );

    if (flagged.length > 0) {
        log(3, `Flagged as hate speech:`, JSON.stringify(flagged));
        return flagged;
    } else {
        log(3, `Prediction below threshold (${threshold}). Marked as non-hate speech:`, `Sentence: "${sentence}"`, `Prediction score: ${prediction[0]?.score || 'N/A'}`);
        return prediction;  // Ensure the prediction is still returned
    }
}


async function analyzeHateSpeech(englishGroup, tagalogGroup) {
    const results = { english: [], tagalog: [] };

    // Process English group without throttling
    if (englishGroup.length > 0) {
        log(3, "Sending English sentences for hate speech detection...");
        results.english = await Promise.all(englishGroup.map(async (sentence) => {
            const prediction = await callHateSpeechAPI(ENGLISH_HATE_SPEECH_MODEL, sentence);
            return prediction;
        }));
    }

    // Process Tagalog group without throttling
    if (tagalogGroup.length > 0) {
        log(3, "Sending Tagalog sentences for hate speech detection...");
        results.tagalog = await Promise.all(tagalogGroup.map(async (sentence) => {
            const prediction = await callHateSpeechAPI(TAGALOG_HATE_SPEECH_MODEL, sentence);
            return prediction;
        }));
    }

    // Apply the threshold based on the current mode
    const threshold = getModeThreshold();

    // Count the hate speech occurrences
    const { englishHateCount, tagalogHateCount } = countHateSpeech(results, threshold);

    log(3, `Hate speech count - English: ${englishHateCount}, Tagalog: ${tagalogHateCount}`);

    return { englishHateCount, tagalogHateCount };
}


// Count hate speeches function, integrated within the existing structure
function countHateSpeech(results, threshold) {
    // Ensure results.english and results.tagalog are arrays, defaulting to empty arrays if undefined
    const englishResults = Array.isArray(results.english) ? results.english : [];
    const tagalogResults = Array.isArray(results.tagalog) ? results.tagalog : [];

    // Count hate speeches in English predictions
    const englishHateCount = englishResults.filter(prediction =>
        Array.isArray(prediction) && prediction.some(pred => pred.label === "HATE" && pred.score >= threshold)
    ).length;

    // Count hate speeches in Tagalog predictions
    const tagalogHateCount = tagalogResults.filter(prediction =>
        Array.isArray(prediction) && prediction.some(pred => pred.label === "LABEL_1" && pred.score >= threshold)
    ).length;

    // Log analysis results
    log(4, "English hate speech analysis results: ", englishResults);
    log(4, "Tagalog hate speech analysis results: ", tagalogResults);

    // Always return an object with both counts
    return {
        englishHateCount: englishHateCount || 0, // Default to 0 if no hate speech found
        tagalogHateCount: tagalogHateCount || 0, // Default to 0 if no hate speech found
    };
}

// Process sentences collected from content script
async function processSentences(sentences) {
    const { englishGroup, tagalogGroup } = await groupByLanguage(sentences);
    const { englishHateCount, tagalogHateCount } = await analyzeHateSpeech(englishGroup, tagalogGroup);

    const detectedHateSpeeches = englishHateCount + tagalogHateCount;

    return { detectedHateSpeeches, englishHateCount, tagalogHateCount }; 
}

// Wait function
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processSentencesInLoop(sentences) {
    // Group sentences by detected language first
    const { englishGroup, tagalogGroup } = await groupByLanguage(sentences);

    // Create an array to hold all processing tasks
    const tasks = [];

    // Process English sentences
    for (const sentence of englishGroup) {
        tasks.push(async () => {
            const prediction = await callHateSpeechAPI(ENGLISH_HATE_SPEECH_MODEL, sentence);
            const flagged = prediction.filter(pred => pred.label === "HATE" && pred.score >= getModeThreshold());
            if (flagged.length > 0) {
                hateSpeechMap[sentence] = flagged; // Store the sentence and its predictions
            }
            return { sentence, prediction: flagged.length > 0 ? flagged : null };
        });
    }

    // Process Tagalog sentences
    for (const sentence of tagalogGroup) {
        tasks.push(async () => {
            const prediction = await callHateSpeechAPI(TAGALOG_HATE_SPEECH_MODEL, sentence);
            const flagged = prediction.filter(pred => pred.label === "LABEL_1" && pred.score >= getModeThreshold());
            if (flagged.length > 0) {
                hateSpeechMap[sentence] = flagged; // Store the sentence and its predictions
            }
            return { sentence, prediction: flagged.length > 0 ? flagged : null };
        });
    }

    // Execute all tasks in parallel using Promise.all
    const results = await Promise.all(tasks.map(task => task()));

    // Log the results
    results.forEach(result => {
        if (result.prediction) {
            log(3, `Processed sentence: "${result.sentence}", Flagged as hate speech: ${JSON.stringify(result.prediction)}`);
        } else {
            log(3, `Processed sentence: "${result.sentence}", No hate speech detected.`);
        }
    });

    return results;
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scanPage") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: "scanPage" }, async (response) => {
                if (response && response.sentences) {
                    log(3, "Collected sentences: ", response.sentences);
                    try {

                        const hateSpeechResults = await processSentencesInLoop(response.sentences);

                        const hateSpeechCount = await processSentences(response.sentences);
                        sendResponse({ scanResult: "success", detectedHateSpeeches: hateSpeechCount, hateSpeechMap });
                    } catch (error) {
                        if (isColdStartError(error)) {
                            const coldStartResponse = await handleColdStart();
                            sendResponse(coldStartResponse);
                        } else {
                            log(1, "Error processing sentences: ", error.message);
                            sendResponse({ scanResult: "maxAttempts", detectedHateSpeeches: 0 });
                        }
                    }
                } else {
                    log(1, "No response from content script");
                    sendResponse({ scanResult: "maxAttempts", detectedHateSpeeches: 0 });
                }
            });
        });
        return true;
    }
});


let notifCount = 0;
let totalSentencesCount = 0; // Track total number of sentences

let enHateCount = 0;
let tlHateCount = 0;

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "processSentence" && request.sentence) {
        try {
            totalSentencesCount++; // Increment total sentences count
            
            // Detect language and process sentence for hate speech
            const language = await detectLanguage(request.sentence);
            let model = language === "english" ? ENGLISH_HATE_SPEECH_MODEL : TAGALOG_HATE_SPEECH_MODEL;
            const prediction = await callHateSpeechAPI(model, request.sentence);

            const threshold = getModeThreshold();
            const isFlagged = prediction.some(pred =>
                (model === ENGLISH_HATE_SPEECH_MODEL && pred.label === "HATE" && pred.score >= threshold) ||
                (model === TAGALOG_HATE_SPEECH_MODEL && pred.label === "LABEL_1" && pred.score >= threshold)
            );

            if (isFlagged) {
                notifCount++;

                if (language === "english") {
                    enHateCount++;
                } else if (language === "tagalog") {
                    tlHateCount++;
                }
                chrome.runtime.sendMessage({
                    action: "updateBadge",
                    count: notifCount,
                    flaggedSentence: request.sentence,
                    timestamp: Date.now()
                });
            }

            chrome.runtime.sendMessage({
                action: "updateStatistics",
                totalSentences: totalSentencesCount,
                flaggedSentences: notifCount,
                englishHateCount: enHateCount,
                tagalogHateCount: tlHateCount 
            });            

            sendResponse({ status: "success", sentence: request.sentence, result: isFlagged ? "FLAGGED" : "NOT FLAGGED" });
        } catch (error) {
            sendResponse({ status: "error", error: error.message });
        }
        return true;
    }
});



chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let keepAlive = true;
    const keepAliveInterval = setInterval(() => {
        if (!keepAlive) clearInterval(keepAliveInterval);
    }, 1000); // Keeps service worker alive

    (async () => {
        try {
            console.log("Received message in background:", request);

            if (request.action === "processChatMessage" && request.sentence) {
                console.log("Starting to process sentence:", request.sentence);

                const language = await detectLanguage(request.sentence);
                console.log("Detected language:", language);

                let model = language === "english" ? ENGLISH_HATE_SPEECH_MODEL : TAGALOG_HATE_SPEECH_MODEL;
                
                try {
                    const prediction = await callHateSpeechAPI(model, request.sentence);
                    console.log("Prediction result:", prediction);
                    sendResponse({ status: "success", predictionResult: prediction });
                } catch (error) {
                    if (isColdStartError(error)) {
                        console.error("Cold start error:", error);
                        sendResponse({ status: "coldStart" });
                    } else if (error.message.includes("token limit")) {
                        console.error("Max token error:", error);
                        sendResponse({ status: "maxToken" });
                    } else {
                        throw error; // Rethrow other errors
                    }
                }
            }
        } catch (error) {
            console.error("Error during message processing:", error);
            sendResponse({ status: "error", message: error.message });
        } finally {
            keepAlive = false;  // Allow service worker to shut down
        }
    })();

    return true;  // Keep message channel open for async response
});








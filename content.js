console.log('Content script listener is ready.');

const excludedPatterns = [
  // Exact sentence patterns
  "view more answers",
  "new message requests",
  "view more comments",
  "come share your findings in the comments",
  "reacted to your message",

  // Regular expressions
  /^view all \d+ replies$/i,
  /^view \d+ reply$/i,
  /^photos from .* post$/i,
  /\b\d+\s*h\b|\b\d+\s+hours?\s+ago\b/i,
  /(?:\d+\s*d|\d+\s+days?\s+ago)/i,
  /\b\d+\s*m\b|\b\d+\s+minutes?\s+ago\b/i,
  /\b\d+h\d+\s+hours?\s+ago\b/i,
  /\b\d+m\s+a\s+few\s+seconds?\s+ago\b/i,
  /.*\s+unsent\s+a\s+message\s*\(.*?\)/i,
  /click on the video to admire its majestic appearance more benefits prepared by \(.*?\) for everyone please check \(.+?\)/i
];

let observer;
const loggedSentences = new Set(); // Track processed sentences
const flaggedSentences = new Set(); // Track flagged sentences
const censoredText = '<span style="font-style: italic;">Removed due to Hate speech</span>';
const highlightedText = '<span style="color: red;">';
const originalTexts = new Map(); // To store original text of each element
const originalTextsRealtime = new Map();
var isRealtimeCensored = true;

var hateSpeechMap = {};
var hateSpeechMapRealtime = {};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scanPage") {
    const sentences = extractValidSentences();
    hateSpeechMap = request.hateSpeechMap || {};

    console.log(`Scanned and found ${sentences.length} unique sentences.`);

    let hateSpeechDetails = '';

    toggleCensorship(hateSpeechMap, true);

    sendResponse({ sentences });
  }

  if (request.action === "toggleCensorship") {
    toggleCensorship(request.hateSpeechMap, request.toggleState);
    toggleCensorshipRealtime(request.toggleState);
  }

  if (request.action === "toggleHighlighted") {
    toggleHighlighted(request.hateSpeechMap, request.toggleState);
  }

  if (request.action === "toggleObserver") {
    if (request.enabled) {
      startObserver();  // Start real-time detection
      console.log("Real-time mode activated on this tab.");
    } else {
      if (observer) observer.disconnect();  // Stop real-time detection
      console.log("Real-time mode deactivated on this tab.");
    }
  }

  if (request.action === "processSentence" && request.sentence) {
    // Process sentence for hate speech
  }

  if (request.action === "toggleCensorshipRealtime") {
    toggleCensorshipRealtime(request.toggleState);
  }

  // New case for setting the mode
  if (request.action === "setMode") {
    console.log(`Setting mode to: ${request.mode}`);
    currentMode = request.mode; // Assume currentMode is defined elsewhere or define it here
  }

  // New case for setting the filter type
  if (request.action === "setFilterType") {
    console.log(`Setting filter to: ${request.filter}`);
    if (request.filter === "filterCensorship") {
      toggleCensorship(hateSpeechMap, true);
    } else if (request.filter === "filterHighlight") {
      toggleHighlighted(hateSpeechMap, true);
    } else if (request.filter === "filterRealTime") {
      toggleCensorshipRealtime(true);
    }
  }
});


function toggleCensorshipRealtime(enable) {
  const elements = document.querySelectorAll('div[dir="auto"], span[dir="auto"],span[dir="auto"][role="text"]');

  elements.forEach(el => {
    if(!enable) {
      if (el.innerHTML === censoredText) {
        // Restore original text
        if (originalTextsRealtime.has(el)) {
          el.innerHTML = originalTextsRealtime.get(el);
        }
      }
    } else {
      if (originalTextsRealtime.has(el)) {
        el.innerHTML = censoredText;
      }
    }
  });
}

function toggleCensorship(hateSpeechMap, enable = true) {
  const elements = document.querySelectorAll('div[dir="auto"], span[dir="auto"],span[dir="auto"][role="text"]');

  elements.forEach(el => {
    const textContent = el.innerText.trim().toLowerCase();
    const originalText = originalTexts.get(el);
    

    // Iterate over the hateSpeechMap to check for matches
    for (const [sentence, predictions] of Object.entries(hateSpeechMap)) {
      if (textContent === sentence.toLowerCase()) {
        if (enable) {
          // Store original text if not already stored
          if (!originalTexts.has(el)) {
            originalTexts.set(el, el.innerHTML); // Store the original HTML content
          }
          

          // Replace with censored text
          el.innerHTML = censoredText;
          isCensored = false;
        }
        break; // Exit the loop once a match is found
      }
    }

    // If enabling censorship is false
    if (!enable) {
      // Check if the element's content matches the censored text
      if (el.innerHTML === censoredText) {
        // Restore original text
        if (originalTexts.has(el)) {
          el.innerHTML = originalTexts.get(el);
        }
      }
    }
  });
}

function toggleHighlighted(hateSpeechMap, enable) {
  const elements = document.querySelectorAll('div[dir="auto"], span[dir="auto"],span[dir="auto"][role="text"]');

  elements.forEach(el => {
    const textContent = el.innerText.trim().toLowerCase();
    const originalText = originalTexts.get(el);

    // Iterate over the hateSpeechMap to check for matches
    for (const [sentence, predictions] of Object.entries(hateSpeechMap)) {
      if (textContent === sentence.toLowerCase()) {
        if (enable) {
          // Store original text if not already stored
          if (!originalTexts.has(el)) {
            originalTexts.set(el, el.innerHTML); // Store the original HTML content
          }

          // Replace with highlighted text
          el.innerHTML = `${highlightedText}${el.innerHTML}</span>`;
        }
        break; // Exit the loop once a match is found
      } else if (el.innerHTML === censoredText) {
        // Replace with highlighted text
        el.innerHTML = `${highlightedText}${getPlainText(originalTexts.get(el))}</span>`;
        break;
      }
    }

    // If enabling censorship is false
    if (!enable) {

      // Check if the element's content starts with the highlighted text
      if (el.innerHTML.startsWith(highlightedText)) {
        // Restore original text
        if (originalTexts.has(el)) {
          el.innerHTML = originalTexts.get(el);
        }
      }
    }

    if(originalTextsRealtime.has(el)) {
      if(enable) {
        if (originalTextsRealtime.has(el)) {
          el.innerHTML = `${highlightedText}${getPlainText(originalTextsRealtime.get(el))}</span>`;
        }

        if(el.innerHTML === censoredText) {
          el.innerHTML = `${highlightedText}${getPlainText(originalTextsRealtime.get(el))}</span>`;
        }
      } else {
        if(el.innerHTML.startsWith(highlightedText)) {
          if (originalTextsRealtime.has(el)) {
            el.innerHTML = originalTextsRealtime.get(el);
          } 
        }
      }
    }
  });

}

function getPlainText(html) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || "";
}


// Check if a sentence matches any excluded patterns (string or regex)
function isExcludedSentence(sentence) {
  return excludedPatterns.some(pattern => {
    if (typeof pattern === 'string') {
      return pattern.toLowerCase() === sentence.toLowerCase(); // Exact match for strings
    } else if (pattern instanceof RegExp) {
      return pattern.test(sentence); // Regex match for patterns
    }
    return false;
  });
}

// Extract and process valid sentences from the page
function extractValidSentences() {
  const postElements = document.querySelectorAll('div[dir="auto"], span[dir="auto"],span[dir="auto"][role="text"]');
  const uniqueSentences = new Set();

  return Array.from(postElements)
    .filter(el => el.innerText.trim().length > 0)
    .filter(el => el.closest('nav, footer, button') === null)
    .filter(el => !containsNestedText(el))
    .flatMap(el => el.innerText.split(/[.!?]+/))
    .map(text => preprocessSentence(text))  // Preprocessing applied here
    .filter(text => text.length > 0 && !isExcludedSentence(text)) // Exclusion check after preprocessing
    .filter(sentence => isValidSentence(sentence) && !uniqueSentences.has(sentence))
    .map(sentence => {
      uniqueSentences.add(sentence);
      return sentence.toLowerCase(); // Ensure the sentence is in lowercase
    });
}

// Function to preprocess sentence
function preprocessSentence(sentence) {
  return cleanRepetitiveWords(
    removeNonAlphanumeric(
      removeExtraWhitespaces(
        removeHtmlTags(sentence.trim().toLowerCase()) // Convert to lowercase
      )
    )
  );
}

// Start the Mutation Observer
function startObserver() {
  const targetNode = document.body;
  const config = { childList: true, subtree: true };

  const callback = function(mutationsList) {
    for (let mutation of mutationsList) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processNodeText(node);
            node.querySelectorAll('div[dir="auto"], span[dir="auto"],span[dir="auto"][role="text"]').forEach(childNode => {
              processNodeText(childNode);
            });
          }
        });
      }
    }
  };

  observer = new MutationObserver(callback);
  observer.observe(targetNode, config);
  console.log('Mutation Observer started and watching for changes in the body.');
}

function processNodeText(node) {
  const relevantElements = node.querySelectorAll('div[dir="auto"], span[dir="auto"], span[dir="auto"][role="text"]');

  relevantElements.forEach(el => {
    const textContent = el.innerText.trim();
    if (textContent) {
      const sentences = extractValidSentencesFromText(textContent);
      sentences.forEach(sentence => {
        if (flaggedSentences.has(sentence)) {
          // Apply censorship directly if the sentence is already flagged
          censorElement(el);
        } else if (!loggedSentences.has(sentence)) {
          // If sentence is not logged, process it and flag if needed
          loggedSentences.add(sentence); // Add to logged sentences set
          console.log('Valid sentence extracted:', sentence);

          // Send the sentence to the background script for processing
          chrome.runtime.sendMessage({ action: "processSentence", sentence }, function(response) {
            if (chrome.runtime.lastError) {
              console.error("Error receiving response:", chrome.runtime.lastError.message);
            } else if (response.result === "FLAGGED") {
              // Mark the sentence as flagged and reapply censorship
              flaggedSentences.add(sentence);
              applyCensorshipToFlaggedSentences();
            } else {
              console.log("Successfully processed sentence:", sentence);
            }
          });
        }
      });
    }
  });
}

function censorElement(el) {
  if (!originalTextsRealtime.has(el)) {
    originalTextsRealtime.set(el, el.innerHTML);
  }
  el.innerHTML = censoredText;
}

function applyCensorshipToFlaggedSentences() {
  // Go through all elements and censor if they contain a flagged sentence
  const allElements = document.querySelectorAll('div[dir="auto"], span[dir="auto"], span[dir="auto"][role="text"]');
  allElements.forEach(el => {
    const textContent = el.innerText.trim();
    const sentences = extractValidSentencesFromText(textContent);
    sentences.forEach(sentence => {
      if (flaggedSentences.has(sentence)) {
        censorElement(el); // Apply censorship to each element containing a flagged sentence
      }
    });
  });
}




// Extract valid sentences from a given text
function extractValidSentencesFromText(text) {
  return text
    .split(/[.!?]+/)
    .map(sentence => preprocessSentence(sentence))  // Preprocessing applied here
    .filter(sentence => sentence.length > 0 && !isExcludedSentence(sentence))
    .filter(sentence => isValidSentence(sentence));
}

// Check if the sentence is valid (three or more words)
function isValidSentence(sentence) {
  const words = sentence.trim().split(/\s+/);
  return words.length >= 3;
}

// Helper Functions
function removeExtraWhitespaces(text) {
  return text.replace(/\s+/g, ' ');
}

// Function to remove HTML tags
function removeHtmlTags(html) {
  return html.replace(/<.*?>/g, ' ');
}

// Function to remove non-alphanumeric characters
function removeNonAlphanumeric(text) {
  return text.replace(/[^a-zA-Z0-9\s]/g, '');
}

// Function to clean repetitive words
function cleanRepetitiveWords(sentence) {
  const words = sentence.split(/\s+/);
  const cleanedWords = [];
  const wordCount = {};

  words.forEach(word => {
    const lowerWord = word.toLowerCase();
    if (!wordCount[lowerWord] || wordCount[lowerWord] < 1) {
      cleanedWords.push(word);
      wordCount[lowerWord] = 1;
    }
  });

  return cleanedWords.join(' ');
}

// Function to check if the element contains nested text content
function containsNestedText(el) {
  return Array.from(el.children).some(child => child.innerText.trim().length > 0);
}

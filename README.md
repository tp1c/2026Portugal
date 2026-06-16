# 2026 Portugal Travel Planning

This project contains the itinerary generator script and output files for the 12-day pre-cruise and cruise travel guide (July 18 – July 29, 2026), featuring a 4-day Lisbon stay and a 7-night Viking Douro River Cruise.

## 📁 Project Structure

- `generate_lisbon_itinerary.js`: Node.js script that fetches/defines the travel data and uses Google APIs to generate/update:
  1. A structured **Google Sheet** (Itinerary details, checklists, and packing list checkboxes).
  2. A styled **Google Doc** travel guide (styled with blue/gold primary colors).
  3. A local **HTML report** (`travel_guide.html`) linking directly to the Sheet and Doc.
- `travel_guide.html`: Local web-based travel guide report.
- `credentials.json` & `token.json`: Google OAuth 2.0 credentials and authorized tokens (ignored in Git if initialized).

## 🚀 How to Run

To regenerate or update the Google Doc, Google Sheet, and HTML report:

1. Update the data arrays inside `generate_lisbon_itinerary.js` if there are any itinerary changes.
2. Run the generator script:
   ```bash
   node generate_lisbon_itinerary.js
   ```

## 🔗 Generated Outputs

* **Google Sheet**: [Open Google Sheet](https://docs.google.com/spreadsheets/d/1BUOe-PhYu4vBBKi9NSLbnIe8VndaALLiBf_9uCIwbp0/edit)
* **Google Doc**: [Open Google Doc](https://docs.google.com/document/d/1ottn1xnLAhFE7J7aIWpFOzFNMINeVttiEWyQ1pALw-8/edit)
* **Local Web Guide**: [travel_guide.html](travel_guide.html)

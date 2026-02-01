import pandas as pd
import requests
from bs4 import BeautifulSoup
import time
import random

# Load the CSV I generated for you
df = pd.read_csv('prospects_with_urls.csv')

def fetch_summary(url):
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # This targets the specific div where scouting reports usually live
            # Note: Selectors may change, but 'player-bio' or 'scouting-report' are standard
            report_div = soup.find('div', class_='player-scouting-report')
            if not report_div:
                report_div = soup.find('div', class_='scouting-report-content')
            
            if report_div:
                return report_div.get_text(strip=True)[:500] # Get first 500 chars (approx 100 words)
        return "Summary not found"
    except Exception as e:
        return f"Error: {e}"

# We'll test on the top 20 first to make sure it works
# Remove [:20] to run on all 857
print("Starting summary pull...")
summaries = []

for index, row in df.head(20).iterrows():
    print(f"Fetching {row['Player Name']}...")
    summary = fetch_summary(row['Profile_URL'])
    summaries.append(summary)
    
    # IMPORTANT: Wait between requests so you don't get blocked!
    time.sleep(random.uniform(1.5, 3.0))

# Save the results
df.loc[:19, 'Summary'] = summaries
df.to_csv('prospects_with_summaries.csv', index=False)
print("Finished! Check prospects_with_summaries.csv")

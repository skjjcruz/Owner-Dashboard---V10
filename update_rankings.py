#!/usr/bin/env python3
"""
NFL Draft Rankings Updater
Fetches rankings from Pro Football Network and updates CSV
"""

import requests
import csv
import json
from datetime import datetime
import sys
import os
import glob

# PFN Industry Consensus JSON endpoint
PFN_JSON_URL = "https://www.profootballnetwork.com/nfl-draft-hq/industry-consensus-big-board/"

# Source name mapping (JSON to CSV column names)
SOURCE_MAPPING = {
    'B/R': 'Drafttech',  # Using as proxy for now
    'CBS': 'CBS',
    'ESPN': 'Mel Kiper',  # ESPN consensus
    'PFF': 'PFF',
    'PFSN': 'PFN',
    'The Athletic': 'NFL Draft Buzz'
}

def fetch_pfn_json():
    """Fetch the JSON data from PFN's page or use local file"""

    # First check if there's a local JSON file (for testing)
    local_json_files = glob.glob('industry-consensus-*.json')
    if local_json_files:
        local_file = sorted(local_json_files)[-1]  # Get most recent
        print(f"📁 Found local JSON file: {local_file}")
        print(f"   Using local file for testing (web fetch disabled)")
        try:
            with open(local_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(f"✅ Successfully loaded {len(data)} players from local file")
                return data
        except Exception as e:
            print(f"❌ Error loading local file: {e}")
            print("   Falling back to web fetch...")

    # If no local file, fetch from web
    print(f"Fetching rankings from {PFN_JSON_URL}")

    try:
        # First, get the HTML page
        response = requests.get(PFN_JSON_URL, timeout=30)
        response.raise_for_status()

        # The JSON is embedded in the page, look for it
        html = response.text

        # Find the JSON data in the HTML (it's in a script tag or data attribute)
        # Pattern: industry-consensus-2026-*.json
        import re
        json_match = re.search(r'industry-consensus-\d{4}-\d{2}-\d{2}\.json', html)

        if json_match:
            json_filename = json_match.group(0)
            json_url = f"https://www.profootballnetwork.com/wp-content/uploads/consensus/{json_filename}"
            print(f"Found JSON file: {json_url}")

            json_response = requests.get(json_url, timeout=30)
            json_response.raise_for_status()
            return json_response.json()
        else:
            print("Could not find JSON filename in HTML, trying direct JSON fetch...")
            # Try a common pattern
            today = datetime.now().strftime('%Y-%m-%d')
            json_url = f"https://www.profootballnetwork.com/wp-content/uploads/consensus/industry-consensus-{today}.json"
            print(f"Trying: {json_url}")

            json_response = requests.get(json_url, timeout=30)
            json_response.raise_for_status()
            return json_response.json()

    except Exception as e:
        print(f"Error fetching PFN data: {e}")
        print("Trying alternative method...")

        # Alternative: try to load from the uploaded file path pattern
        try:
            # The file was named industry-consensus-2026-01-29.json
            # Try recent dates
            from datetime import timedelta
            for days_back in range(7):
                check_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
                json_url = f"https://www.profootballnetwork.com/wp-content/uploads/consensus/industry-consensus-{check_date}.json"
                print(f"Trying date: {check_date}")

                try:
                    json_response = requests.get(json_url, timeout=10)
                    if json_response.status_code == 200:
                        print(f"Success! Found data from {check_date}")
                        return json_response.json()
                except:
                    continue

            raise Exception("Could not find JSON file for any recent date")

        except Exception as e2:
            print(f"Alternative method failed: {e2}")
            sys.exit(1)

def transform_to_csv(json_data, output_file):
    """Transform JSON data to CSV format matching the existing schema"""
    print(f"Transforming {len(json_data)} players to CSV format")
    
    # Prepare CSV rows
    csv_rows = []
    
    for player in json_data:
        row = {
            'Player Name': player.get('name', ''),
            'Position': player.get('position', ''),
            'School': player.get('school', ''),
            'Year': player.get('year', ''),
            'Height': player.get('height', ''),
            'Weight': player.get('weight', ''),
            '40 Time': '',  # Not in PFN data
            'PFF': '',
            'NFL Draft Buzz': '',
            'PFN': '',
            'TANKATHON': '',
            'Drafttech': '',
            'CBS': '',
            'Mel Kiper': '',
            'Field Yates': '',
            'Matt Miller': '',
            'Daniel Jeremiah': '',
            'Charlie Campbell': '',
            'Average': '',
            'Remarks': ''
        }
        
        # Add analyst rankings
        analyst_ranks = player.get('analystRanks', {})
        
        # Map the sources
        if 'PFF' in analyst_ranks:
            row['PFF'] = analyst_ranks['PFF']
        if 'CBS' in analyst_ranks:
            row['CBS'] = analyst_ranks['CBS']
        if 'ESPN' in analyst_ranks:
            row['Mel Kiper'] = analyst_ranks['ESPN']
        if 'PFSN' in analyst_ranks:
            row['PFN'] = analyst_ranks['PFSN']
        if 'B/R' in analyst_ranks:
            row['Drafttech'] = analyst_ranks['B/R']
        if 'The Athletic' in analyst_ranks:
            row['NFL Draft Buzz'] = analyst_ranks['The Athletic']
            
        csv_rows.append(row)
    
    # Write to CSV
    print(f"Writing {len(csv_rows)} rows to {output_file}")
    
    fieldnames = ['Player Name', 'Position', 'School', 'Year', 'Height', 'Weight', '40 Time',
                  'PFF', 'NFL Draft Buzz', 'PFN', 'TANKATHON', 'Drafttech', 'CBS', 
                  'Mel Kiper', 'Field Yates', 'Matt Miller', 'Daniel Jeremiah', 
                  'Charlie Campbell', 'Average', 'Remarks']
    
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(csv_rows)
    
    print(f"✅ Successfully wrote CSV with {len(csv_rows)} players")
    return len(csv_rows)

def add_timestamp_to_file(output_file):
    """Add update timestamp to the CSV"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')
    print(f"Last updated: {timestamp}")
    
    # Could add this as a comment in the CSV or a separate file
    with open(output_file.replace('.csv', '_timestamp.txt'), 'w') as f:
        f.write(f"Last updated: {timestamp}\n")

def main():
    """Main execution function"""
    print("=" * 60)
    print("NFL Draft Rankings Updater")
    print("=" * 60)
    
    output_file = '2026-Dynasty-Rankings.csv'
    
    # Step 1: Fetch JSON data
    json_data = fetch_pfn_json()
    
    if not json_data:
        print("❌ No data fetched, exiting")
        sys.exit(1)
    
    print(f"✅ Fetched data for {len(json_data)} players")
    
    # Step 2: Transform to CSV
    num_players = transform_to_csv(json_data, output_file)
    
    # Step 3: Add timestamp
    add_timestamp_to_file(output_file)
    
    print("=" * 60)
    print(f"✅ SUCCESS! Updated {num_players} players")
    print("=" * 60)
    
    return 0

if __name__ == '__main__':
    sys.exit(main())


import requests
from bs4 import BeautifulSoup
from time import sleep
import urllib.parse
import json
from datetime import datetime, timedelta

cookies = {"i18n-prefs": "JPY", "lc-acbjp": "ja_JP"}

base_url = "https://www.amazon.co.jp"
max_retry = 30
max_items = 5


def request_with_retry(url: str, cookies: dict = cookies, retry: int = 30):
    for i in range(retry):
        html = requests.get(url, cookies)
        soup = BeautifulSoup(html.content, "html.parser")
        sleep(1)
        if "ご迷惑をおかけしています！" in soup.find("title").string:
            pass  # 再リクエスト
        else:
            break
    return soup


def search(search_keyword):
    url = f"{base_url}/s?k={search_keyword}"
    print(f"search url : {url}")
    base_soup = request_with_retry(url)
    item_list = []
    for element_tag in base_soup.find_all(
        "a",
        attrs={
            "class": "a-link-normal s-underline-text s-underline-link-text s-link-style a-text-normal"
        },
    )[:max_items]:
        item_dict = {
            "name": str(element_tag.contents[0].contents[0]),
            "url": f'{base_url}/dp/{element_tag.attrs["href"].split("/dp/")[1]}',
        }
        soup = request_with_retry(item_dict["url"])
        _description = ""
        for element_tag in soup.find_all(
            "div", attrs={"class": "a-section a-spacing-medium a-spacing-top-small"}
        ):
            for e in element_tag.contents:
                if str(type(e)) == "<class 'bs4.element.Tag'>":
                    _description += str(e)
        description = ""
        extract_flag = True
        for description_letter in _description:
            if description_letter == "<":
                extract_flag = False

            if extract_flag:
                description += description_letter

            if description_letter == ">":
                extract_flag = True
        item_dict["description"] = description
        print(item_dict)
        item_list.append(item_dict)
    return item_list


def submit(url):
    print(f"{url} \n を購入します。")
    return {
        "is_submitted": True,
        "delivery_date": (datetime.now() + timedelta(1)).strftime("%Y-%m-%d"),
    }


def lambda_handler(event, context):

    print(event)

    api_path = event["apiPath"]

    if api_path == "/search":
        search_keyword = urllib.parse.quote(event["parameters"][0]["value"])
        body = search(search_keyword)

    elif api_path == "/submit":
        url = urllib.parse.quote(event["parameters"][0]["value"])
        body = submit(url)

    response_body = {"application/json": {"body": json.dumps(body, ensure_ascii=False)}}

    action_response = {
        "actionGroup": event["actionGroup"],
        "apiPath": event["apiPath"],
        "httpMethod": event["httpMethod"],
        "httpStatusCode": 200,
        "responseBody": response_body,
    }

    api_response = {"messageVersion": "1.0", "response": action_response}

    return api_response
